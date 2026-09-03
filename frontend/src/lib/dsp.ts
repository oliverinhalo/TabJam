/**
 * Signal processing for acoustic calibration.
 *
 * Deliberately free of browser APIs: everything here is plain arrays and maths,
 * so the detector can be tested against synthetic signals without a browser or
 * a microphone (see scripts/test-dsp.mjs).
 */

export interface ChirpSpec {
  startHz: number;
  endHz: number;
  durationMs: number;
}

/**
 * Audible default.
 *
 * 1.5–4.5kHz sits where small phone speakers and microphones are most
 * sensitive, and it is short enough to read as a blip rather than a beep.
 * Near-ultrasonic alternatives are tempting because they are unobtrusive, but
 * cheap phone hardware rolls off above ~18kHz, so they fail on exactly the
 * devices most people bring to a practice.
 */
export const DEFAULT_CHIRP: ChirpSpec = {
  startHz: 1500,
  endHz: 4500,
  durationMs: 50,
};

/** Higher, less obtrusive variant. Works on some hardware; test before relying on it. */
export const HIGH_CHIRP: ChirpSpec = {
  startHz: 12000,
  endHz: 16000,
  durationMs: 50,
};

/**
 * Build a linear frequency sweep.
 *
 * A sweep is used rather than a tone because its autocorrelation is a sharp
 * spike: a matched filter locks onto it to within a sample or two, where a
 * fixed tone would give a broad, ambiguous correlation ridge.
 *
 * The Hann window matters for more than tidiness — an abrupt start would put a
 * broadband click at the edges, and the detector would happily lock onto the
 * click instead of the sweep.
 */
export function generateChirp(spec: ChirpSpec, sampleRate: number): Float32Array {
  const length = Math.max(1, Math.round((spec.durationMs / 1000) * sampleRate));
  const samples = new Float32Array(length);
  const duration = length / sampleRate;
  const sweepRate = (spec.endHz - spec.startHz) / duration;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Phase of a linear sweep is the integral of instantaneous frequency.
    const phase = 2 * Math.PI * (spec.startHz * t + (sweepRate * t * t) / 2);
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1 || 1)));
    samples[i] = Math.sin(phase) * window;
  }
  return samples;
}

/** Box-average decimation. Cheap, and it improves SNR as a side effect. */
export function decimate(signal: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return signal;
  const length = Math.floor(signal.length / factor);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) sum += signal[base + j];
    out[i] = sum / factor;
  }
  return out;
}

export interface DetectionResult {
  /** Index into the recording where the reference starts. -1 if not found. */
  sampleIndex: number;
  /** Correlation peak relative to background. Higher means more certain. */
  confidence: number;
}

/**
 * Normalised cross-correlation of `reference` against `signal`.
 *
 * Normalising by the signal window's energy makes the score independent of how
 * loud the chirp came back, which matters because playback volume, distance
 * and mic gain all vary. Without it, a loud burst of unrelated noise could
 * outscore a correctly matched but quiet chirp.
 *
 * Returns the score at every lag from 0 to `maxLag`.
 */
export function correlate(
  signal: Float32Array,
  reference: Float32Array,
  maxLag: number
): Float32Array {
  const m = reference.length;
  const lags = Math.max(0, Math.min(maxLag, signal.length - m));
  const scores = new Float32Array(lags);

  // Running energy of the signal window, so each lag is O(m) not O(m) + O(m).
  let energy = 0;
  for (let i = 0; i < m && i < signal.length; i++) energy += signal[i] * signal[i];

  for (let lag = 0; lag < lags; lag++) {
    let dot = 0;
    for (let i = 0; i < m; i++) dot += signal[lag + i] * reference[i];

    scores[lag] = energy > 1e-12 ? dot / Math.sqrt(energy) : 0;

    // Slide the energy window forward one sample.
    energy -= signal[lag] * signal[lag];
    const next = lag + m;
    if (next < signal.length) energy += signal[next] * signal[next];
  }
  return scores;
}

/**
 * Locate a reference signal inside a recording.
 *
 * Two passes: a decimated sweep to find roughly where the chirp is, then a
 * full-rate search in a small window around it. A single full-rate pass over a
 * second of 48kHz audio is tens of millions of operations and visibly janks a
 * phone; decimating by 4 first cuts that by ~16x, and the refinement pass
 * restores sample accuracy.
 *
 * `confidence` is the peak divided by the RMS of everything outside a guard
 * band around it — literally "how far the match stands above the background".
 */
export function detectChirp(
  recording: Float32Array,
  reference: Float32Array,
  options: { maxLagSamples: number; decimation?: number } = { maxLagSamples: 0 }
): DetectionResult {
  const decimation = options.decimation ?? 4;
  const maxLag = Math.min(options.maxLagSamples, recording.length - reference.length);
  if (maxLag <= 0 || reference.length === 0) {
    return { sampleIndex: -1, confidence: 0 };
  }

  // --- Coarse pass ---
  const coarseSignal = decimate(recording, decimation);
  const coarseRef = decimate(reference, decimation);
  const coarseScores = correlate(
    coarseSignal,
    coarseRef,
    Math.ceil(maxLag / decimation)
  );
  if (coarseScores.length === 0) return { sampleIndex: -1, confidence: 0 };

  let peakIndex = 0;
  let peakValue = -Infinity;
  for (let i = 0; i < coarseScores.length; i++) {
    if (coarseScores[i] > peakValue) {
      peakValue = coarseScores[i];
      peakIndex = i;
    }
  }

  // Background: everything outside a guard band around the peak. The guard has
  // to be wide enough to exclude the correlation's own shoulders, or the peak
  // ends up compared against itself and every match looks weak.
  const guard = Math.max(4, Math.round(coarseRef.length / 2));
  let sumSquares = 0;
  let count = 0;
  for (let i = 0; i < coarseScores.length; i++) {
    if (Math.abs(i - peakIndex) <= guard) continue;
    sumSquares += coarseScores[i] * coarseScores[i];
    count++;
  }
  const background = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  const confidence = background > 1e-9 ? peakValue / background : 0;

  // --- Refinement pass ---
  const centre = peakIndex * decimation;
  const windowRadius = decimation * 4;
  const from = Math.max(0, centre - windowRadius);
  const to = Math.min(maxLag, centre + windowRadius);

  let bestIndex = centre;
  let bestScore = -Infinity;
  const refLength = reference.length;

  for (let lag = from; lag <= to; lag++) {
    let dot = 0;
    let energy = 0;
    for (let i = 0; i < refLength; i++) {
      const sample = recording[lag + i];
      dot += sample * reference[i];
      energy += sample * sample;
    }
    const score = energy > 1e-12 ? dot / Math.sqrt(energy) : 0;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = lag;
    }
  }

  return { sampleIndex: bestIndex, confidence };
}

// ---------------------------------------------------------------------------
// Pitch detection, for the tuner
// ---------------------------------------------------------------------------

export interface PitchReading {
  frequencyHz: number;
  /** 0..1 confidence that this is a real pitched note rather than noise. */
  clarity: number;
}

/** Lowest and highest notes worth looking for: a bass low B up past a guitar's top frets. */
const MIN_PITCH_HZ = 30;
const MAX_PITCH_HZ = 1400;
/** Below this the input is treated as silence rather than a very quiet note. */
const SILENCE_RMS = 0.008;
/** Peaks weaker than this are noise, not a note. */
const MIN_CLARITY = 0.85;

/**
 * Estimate the pitch of a buffer using the McLeod normalised square difference
 * function.
 *
 * Chosen over plain autocorrelation because plain autocorrelation happily
 * reports a note an octave too low: every multiple of the true period is also a
 * strong peak. Normalising against the signal's own energy flattens that bias,
 * and taking the *first* peak within range of the maximum rather than the
 * highest one keeps it on the fundamental — which matters for a guitar, whose
 * harmonics are often louder than its fundamental.
 *
 * Returns null for silence or anything too unpitched to call.
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number
): PitchReading | null {
  const n = samples.length;

  let sumSquares = 0;
  for (let i = 0; i < n; i++) sumSquares += samples[i] * samples[i];
  if (Math.sqrt(sumSquares / n) < SILENCE_RMS) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_PITCH_HZ));
  const maxLag = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / MIN_PITCH_HZ));
  if (maxLag <= minLag) return null;

  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0;
    let energy = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) {
      const a = samples[i];
      const b = samples[i + lag];
      correlation += a * b;
      energy += a * a + b * b;
    }
    nsdf[lag] = energy > 0 ? (2 * correlation) / energy : 0;
  }

  // Highest peak first, then settle for the earliest peak close to it: that is
  // the fundamental rather than one of its octaves.
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) if (nsdf[lag] > best) best = nsdf[lag];
  if (best < MIN_CLARITY) return null;

  const threshold = best * 0.9;
  let chosen = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const isPeak = nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1];
    if (isPeak && nsdf[lag] >= threshold) {
      chosen = lag;
      break;
    }
  }
  if (chosen < 0) return null;

  // Parabolic interpolation around the peak: without it the reading quantises
  // to whole samples, which near the top of the range is worth tens of cents.
  const y0 = nsdf[chosen - 1];
  const y1 = nsdf[chosen];
  const y2 = nsdf[chosen + 1];
  const denominator = 2 * (2 * y1 - y0 - y2);
  const refined = denominator !== 0 ? chosen + (y2 - y0) / denominator : chosen;

  return { frequencyHz: sampleRate / refined, clarity: nsdf[chosen] };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface NoteReading {
  /** e.g. "E2" */
  name: string;
  /** How far off, in cents. Negative is flat, positive sharp. */
  cents: number;
  frequencyHz: number;
}

/** Convert a frequency to the nearest note and how far off it is. */
export function frequencyToNote(frequencyHz: number, concertA = 440): NoteReading {
  const midi = 69 + 12 * Math.log2(frequencyHz / concertA);
  const nearest = Math.round(midi);
  return {
    name: `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`,
    cents: Math.round((midi - nearest) * 100),
    frequencyHz,
  };
}
