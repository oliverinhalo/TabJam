import {
  MAX_CALIBRATION_OFFSET_MS,
  MIN_CALIBRATION_CONFIDENCE,
  type CalibrationResult,
} from '@tabjam/shared';
import { DEFAULT_CHIRP, type ChirpSpec, detectChirp, generateChirp } from './dsp';

/**
 * Acoustic latency calibration.
 *
 * Measures the real delay between handing audio to the browser and that sound
 * actually leaving the speaker — the part software timing cannot see. Bluetooth
 * speakers and headphones routinely add 100–300ms of it.
 *
 * Scoped as an explicit, on-demand check rather than continuous correction: in
 * a room with live drums and amps, matched filtering against a brief chirp is
 * reliable, but continuously tracking the song mix would not be.
 */

/** How long to listen after the chirp is scheduled. */
const LISTEN_WINDOW_MS = 900;
/**
 * Lead time before emitting, so the graph and recorder are both settled.
 * Exported so a mutual round can announce the emission time accurately.
 */
export const SCHEDULE_LEAD_MS = 250;
/** Chirp playback gain. Audible but brief — a blip, not a screech. */
const CHIRP_GAIN = 0.35;

export class CalibrationError extends Error {
  constructor(
    message: string,
    readonly reason: 'unsupported' | 'denied' | 'failed'
  ) {
    super(message);
    this.name = 'CalibrationError';
  }
}

/**
 * Whether calibration could run at all.
 *
 * `getUserMedia` needs a secure context, which is easy to overlook on a
 * self-hosted box served over plain HTTP on the LAN.
 */
export function isCalibrationSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.isSecureContext) return false;
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

export function calibrationUnsupportedReason(): string | null {
  if (typeof window === 'undefined') return 'Not running in a browser.';
  if (!window.isSecureContext) {
    return 'Microphone access needs HTTPS. Serve TabJam over TLS to calibrate.';
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser does not expose microphone access.';
  }
  return null;
}

/**
 * Open the microphone.
 *
 * Every piece of "helpful" processing is turned off deliberately. Echo
 * cancellation in particular exists precisely to remove speaker output from the
 * mic signal — which is the exact signal being measured here. Leaving it on
 * makes the chirp undetectable.
 */
async function openMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new CalibrationError('Microphone access was declined.', 'denied');
    }
    if (name === 'NotFoundError') {
      throw new CalibrationError('No microphone on this device.', 'unsupported');
    }
    throw new CalibrationError('Could not open the microphone.', 'unsupported');
  }
}

interface TwoChannelRecording {
  /** What the microphone heard. */
  mic: Float32Array;
  /** The chirp tapped straight off the audio graph, before the hardware. */
  reference: Float32Array;
  sampleRate: number;
}

/**
 * Play the chirp and record two channels at once: the microphone, and a direct
 * electrical tap of the same chirp node.
 *
 * The direct tap is what makes this measurement trustworthy. Timing the mic
 * against `AudioContext.currentTime` would fold in the unknown delay before the
 * recorder's first buffer arrives — up to a whole buffer, tens of milliseconds,
 * which is the same order as the thing being measured. Recording both signals
 * through the *same* recorder and the same sample clock turns it into a
 * difference between two sample indices, and all of that uncertainty cancels.
 */
async function playAndRecord(
  context: AudioContext,
  stream: MediaStream,
  chirp: Float32Array
): Promise<TwoChannelRecording> {
  const sampleRate = context.sampleRate;

  const buffer = context.createBuffer(1, chirp.length, sampleRate);
  buffer.getChannelData(0).set(chirp);

  const source = context.createBufferSource();
  source.buffer = buffer;

  const micSource = context.createMediaStreamSource(stream);
  const merger = context.createChannelMerger(2);

  // Channel 0: acoustic return. Channel 1: direct reference.
  micSource.connect(merger, 0, 0);
  source.connect(merger, 0, 1);

  // The audible path, kept separate so gain changes don't affect the reference.
  const outputGain = context.createGain();
  outputGain.gain.value = CHIRP_GAIN;
  source.connect(outputGain);
  outputGain.connect(context.destination);

  // ScriptProcessorNode is deprecated, but it is supported everywhere including
  // older iOS Safari, needs no separate worklet module, and only runs for about
  // a second. Its main-thread scheduling jitter does not affect accuracy here:
  // timing comes from sample indices inside the captured buffers, not from when
  // the callbacks happen to fire.
  const bufferSize = 4096;
  const recorder = context.createScriptProcessor(bufferSize, 2, 2);

  const micChunks: Float32Array[] = [];
  const refChunks: Float32Array[] = [];

  recorder.onaudioprocess = (event) => {
    micChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    refChunks.push(new Float32Array(event.inputBuffer.getChannelData(1)));
  };

  merger.connect(recorder);
  // Some browsers only run a ScriptProcessorNode when it reaches the
  // destination; a zero gain keeps it alive without creating a feedback loop.
  const silence = context.createGain();
  silence.gain.value = 0;
  recorder.connect(silence);
  silence.connect(context.destination);

  const startAt = context.currentTime + SCHEDULE_LEAD_MS / 1000;
  source.start(startAt);

  await new Promise((resolve) =>
    setTimeout(resolve, SCHEDULE_LEAD_MS + LISTEN_WINDOW_MS)
  );

  try {
    source.stop();
  } catch {
    // Already finished; nothing to stop.
  }
  recorder.onaudioprocess = null;
  recorder.disconnect();
  merger.disconnect();
  micSource.disconnect();
  outputGain.disconnect();
  silence.disconnect();

  return {
    mic: concat(micChunks),
    reference: concat(refChunks),
    sampleRate,
  };
}

function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Split a measured round trip into the output share.
 *
 * The acoustic measurement is unavoidably a round trip: speaker path, air, then
 * microphone path. Only the output share matters for sync — it is what decides
 * when sound reaches a listener's ears relative to the position being
 * broadcast.
 *
 * Chrome and Firefox report `AudioContext.outputLatency` directly and it does
 * account for Bluetooth, so it is preferred when present and plausible. Safari
 * does not implement it, and there the input and output buffer chains are
 * assumed roughly symmetric, so the round trip is split in half. That is an
 * assumption, not a measurement, which is why the UI shows the raw round trip
 * alongside the applied correction.
 */
function estimateOutputLatency(roundTripMs: number, context: AudioContext): number {
  const reported = (context as AudioContext & { outputLatency?: number })
    .outputLatency;

  if (typeof reported === 'number' && Number.isFinite(reported) && reported > 0) {
    const reportedMs = reported * 1000;
    if (reportedMs < roundTripMs) return reportedMs;
  }
  return roundTripMs / 2;
}

export interface SelfCalibrationOptions {
  spec?: ChirpSpec;
  /** Existing context to reuse. iOS is strict about creating these outside a gesture. */
  context?: AudioContext;
}

/**
 * Phase 1: measure this device's own speaker latency using its own microphone.
 *
 * Needs a user gesture on the calling side — iOS Safari will not start an
 * AudioContext or grant microphone access otherwise.
 */
export async function runSelfCalibration(
  options: SelfCalibrationOptions = {}
): Promise<CalibrationResult> {
  const unsupported = calibrationUnsupportedReason();
  if (unsupported) throw new CalibrationError(unsupported, 'unsupported');

  const spec = options.spec ?? DEFAULT_CHIRP;
  const stream = await openMicrophone();

  const context =
    options.context ??
    new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();

  try {
    if (context.state === 'suspended') await context.resume();

    const chirp = generateChirp(spec, context.sampleRate);
    const recording = await playAndRecord(context, stream, chirp);

    const maxLagSamples = Math.round(
      ((MAX_CALIBRATION_OFFSET_MS + spec.durationMs) / 1000) * recording.sampleRate
    );

    // Where the chirp entered the graph, and where it came back acoustically.
    const referenceHit = detectChirp(recording.reference, chirp, { maxLagSamples });
    const micHit = detectChirp(recording.mic, chirp, { maxLagSamples });

    if (referenceHit.sampleIndex < 0) {
      throw new CalibrationError(
        'Could not find the reference signal. Playback may be blocked.',
        'failed'
      );
    }
    if (micHit.sampleIndex < 0 || micHit.confidence < MIN_CALIBRATION_CONFIDENCE) {
      throw new CalibrationError(
        'Could not hear the calibration tone. Try again somewhere quieter, ' +
          'or turn the volume up.',
        'failed'
      );
    }

    const roundTripMs =
      ((micHit.sampleIndex - referenceHit.sampleIndex) / recording.sampleRate) * 1000;

    if (roundTripMs < 0 || roundTripMs > MAX_CALIBRATION_OFFSET_MS) {
      throw new CalibrationError(
        `Measured an implausible delay (${Math.round(roundTripMs)}ms). ` +
          'Something else probably matched the tone.',
        'failed'
      );
    }

    return {
      roundTripMs,
      outputLatencyMs: estimateOutputLatency(roundTripMs, context),
      confidence: micHit.confidence,
      measuredAt: Date.now(),
    };
  } finally {
    for (const track of stream.getTracks()) track.stop();
    // Only dispose a context we created ourselves.
    if (!options.context) await context.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: cross-device
// ---------------------------------------------------------------------------

/**
 * Smaller capture buffer for listening.
 *
 * Phase 1 gets its precision from the direct electrical tap, so buffer size is
 * irrelevant there. A listening device has no such reference — it can only
 * relate sample indices to the wall clock via when the first buffer arrived,
 * so the buffer length is the floor on that mapping's accuracy. 256 samples is
 * the smallest ScriptProcessorNode allows: about 5ms at 48kHz.
 */
const LISTEN_BUFFER_SIZE = 256;

export interface ChirpArrival {
  /** Local clock time at which the chirp actually arrived. */
  arrivedAtLocal: number;
  confidence: number;
}

/**
 * Listen for a chirp emitted by another device.
 *
 * Less precise than the self-test by construction: without a local reference
 * signal the measurement inherits the capture buffer granularity and this
 * device's own microphone input latency. Good enough to catch a speaker that
 * is hundreds of milliseconds late; not a substitute for Phase 1.
 */
export async function listenForChirp(options: {
  spec?: ChirpSpec;
  /** How long to keep listening. */
  windowMs: number;
  context?: AudioContext;
}): Promise<ChirpArrival> {
  const unsupported = calibrationUnsupportedReason();
  if (unsupported) throw new CalibrationError(unsupported, 'unsupported');

  const spec = options.spec ?? DEFAULT_CHIRP;
  const stream = await openMicrophone();
  const context =
    options.context ??
    new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();

  try {
    if (context.state === 'suspended') await context.resume();

    const micSource = context.createMediaStreamSource(stream);
    const recorder = context.createScriptProcessor(LISTEN_BUFFER_SIZE, 1, 1);
    const chunks: Float32Array[] = [];

    // Local time corresponding to sample 0 of the capture.
    let captureStartLocal: number | null = null;

    recorder.onaudioprocess = (event) => {
      if (captureStartLocal === null) {
        // This callback carries samples recorded just before it fired, so the
        // buffer's first sample is one buffer-length in the past.
        captureStartLocal =
          Date.now() - (LISTEN_BUFFER_SIZE / context.sampleRate) * 1000;
      }
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };

    micSource.connect(recorder);
    const silence = context.createGain();
    silence.gain.value = 0;
    recorder.connect(silence);
    silence.connect(context.destination);

    await new Promise((resolve) => setTimeout(resolve, options.windowMs));

    recorder.onaudioprocess = null;
    recorder.disconnect();
    micSource.disconnect();
    silence.disconnect();

    if (captureStartLocal === null) {
      throw new CalibrationError('The microphone produced no audio.', 'failed');
    }

    const recording = concat(chunks);
    const chirp = generateChirp(spec, context.sampleRate);
    const hit = detectChirp(recording, chirp, {
      maxLagSamples: recording.length - chirp.length,
    });

    if (hit.sampleIndex < 0 || hit.confidence < MIN_CALIBRATION_CONFIDENCE) {
      throw new CalibrationError('Did not hear the calibration tone.', 'failed');
    }

    return {
      arrivedAtLocal:
        captureStartLocal + (hit.sampleIndex / context.sampleRate) * 1000,
      confidence: hit.confidence,
    };
  } finally {
    for (const track of stream.getTracks()) track.stop();
    if (!options.context) await context.close().catch(() => undefined);
  }
}

/**
 * Emit a chirp at a specific point on this device's clock.
 *
 * Returns the local time the chirp was scheduled to leave the graph, so the
 * caller can convert it to server time for the announcement.
 */
export async function emitChirp(options: {
  spec?: ChirpSpec;
  context: AudioContext;
  /** How far ahead to schedule, giving listeners time to arm. */
  leadMs: number;
}): Promise<number> {
  const spec = options.spec ?? DEFAULT_CHIRP;
  const { context } = options;
  if (context.state === 'suspended') await context.resume();

  const chirp = generateChirp(spec, context.sampleRate);
  const buffer = context.createBuffer(1, chirp.length, context.sampleRate);
  buffer.getChannelData(0).set(chirp);

  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.value = CHIRP_GAIN;
  source.connect(gain);
  gain.connect(context.destination);

  const emitAtContextTime = context.currentTime + options.leadMs / 1000;
  const emitAtLocal = Date.now() + options.leadMs;
  source.start(emitAtContextTime);

  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };

  return emitAtLocal;
}
