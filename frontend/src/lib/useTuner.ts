import { useCallback, useEffect, useRef, useState } from 'react';
import { detectPitch, frequencyToNote, type NoteReading } from './dsp';
import { CalibrationError, calibrationUnsupportedReason, openMicrophone } from './calibration';

/**
 * Microphone tuner.
 *
 * Entirely local: nothing is sent anywhere, and it holds the microphone only
 * while it is switched on. Shares the calibration module's microphone helper so
 * the constraints stay in one place — processing like echo cancellation and
 * automatic gain would distort the very signal being measured.
 */

/**
 * Analysis window.
 *
 * Long enough to hold two periods of the lowest note worth finding: a bass low
 * E is about 41Hz, or 1170 samples at 48kHz, and the detector needs a couple of
 * periods to lock on. 8192 samples is roughly 170ms — still quick enough to
 * follow a string being turned.
 */
const WINDOW_SAMPLES = 8192;
const CAPTURE_BUFFER = 2048;

export interface TunerState {
  running: boolean;
  supported: boolean;
  error: string | null;
  /** Latest reading, or null when nothing pitched is being heard. */
  reading: NoteReading | null;
}

export function useTuner(): TunerState & { start: () => Promise<void>; stop: () => void } {
  const [running, setRunning] = useState(false);
  const [reading, setReading] = useState<NoteReading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;

    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;

    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;

    setRunning(false);
    setReading(null);
  }, []);

  const start = useCallback(async () => {
    const unsupported = calibrationUnsupportedReason();
    if (unsupported) {
      setError(unsupported);
      return;
    }

    setError(null);
    try {
      const stream = await openMicrophone();
      streamRef.current = stream;

      const context = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
      contextRef.current = context;
      if (context.state === 'suspended') await context.resume();

      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(CAPTURE_BUFFER, 1, 1);

      // Rolling window, so each analysis sees a full note rather than one buffer.
      const rolling = new Float32Array(WINDOW_SAMPLES);
      let filled = 0;

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        rolling.copyWithin(0, input.length);
        rolling.set(input, WINDOW_SAMPLES - input.length);
        filled = Math.min(WINDOW_SAMPLES, filled + input.length);
        if (filled < WINDOW_SAMPLES) return;

        const pitch = detectPitch(rolling, context.sampleRate);
        setReading(pitch ? frequencyToNote(pitch.frequencyHz) : null);
      };

      source.connect(processor);
      // A zero gain keeps the processor running without feeding the mic back
      // into the speakers, which would howl.
      const silence = context.createGain();
      silence.gain.value = 0;
      processor.connect(silence);
      silence.connect(context.destination);

      cleanupRef.current = () => {
        processor.onaudioprocess = null;
        processor.disconnect();
        source.disconnect();
        silence.disconnect();
      };

      setRunning(true);
    } catch (err) {
      setError(
        err instanceof CalibrationError ? err.message : 'Could not open the microphone.'
      );
      stop();
    }
  }, [stop]);

  // Never leave the microphone open behind us.
  useEffect(() => stop, [stop]);

  return {
    running,
    supported: calibrationUnsupportedReason() === null,
    error,
    reading,
    start,
    stop,
  };
}
