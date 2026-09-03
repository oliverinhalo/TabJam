import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_CALIBRATION_OFFSET_MS,
  MIN_CALIBRATION_CONFIDENCE,
  type CalibrationResult,
  type CalibrationStatus,
} from '@tabjam/shared';
import { DEFAULT_CHIRP } from './dsp';
import {
  CalibrationError,
  calibrationUnsupportedReason,
  emitChirp,
  isCalibrationSupported,
  listenForChirp,
  runSelfCalibration,
} from './calibration';
import { SCHEDULE_LEAD_MS } from './calibration';
import type { ChirpAnnouncement, ChirpTurn } from './useRoom';
import type { ClockSync } from './clock';

/**
 * Calibration lifecycle.
 *
 * Strictly an enhancement: if the microphone is unavailable or declined, every
 * value here stays null and the app runs on network-only sync exactly as it did
 * before. Nothing downstream may treat a calibration result as required.
 */

const STORAGE_KEY = 'tabjam.calibration';
/** Lead time between announcing a chirp and emitting it. */
const CHIRP_LEAD_MS = 600;
/** How long a listener keeps recording after the expected arrival. */
const LISTEN_TAIL_MS = 700;

interface StoredCalibration {
  roundTripMs: number;
  outputLatencyMs: number;
  confidence: number;
  measuredAt: number;
}

function loadStored(): StoredCalibration | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCalibration;
    // A measurement is tied to whatever was plugged in at the time, so an old
    // one is a guess about different hardware. A day is generous.
    if (Date.now() - parsed.measuredAt > 24 * 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStored(result: CalibrationResult | null): void {
  try {
    if (result === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch {
    // Storage unavailable; the measurement just won't persist.
  }
}

export interface CrossDeviceReading {
  deviceId: string;
  offsetMs: number;
  confidence: number;
  at: number;
}

export interface CalibrationApi {
  supported: boolean;
  unsupportedReason: string | null;
  status: CalibrationStatus;
  result: CalibrationResult | null;
  error: string | null;
  /** Correction for this device's own cursor, from a cross-device measurement. */
  listenerOffsetMs: number | null;
  /** Whether a cross-device chirp round is in progress. */
  chirpBusy: boolean;

  calibrate: () => Promise<void>;
  clear: () => void;
  runChirpRound: () => Promise<void>;
  /** Run a mutual round: every device measured in turn, others listening. */
  runMutualRound: () => void;
  /** Non-null while a mutual round is running. */
  activeTurn: ChirpTurn | null;
}

interface Args {
  /** This device's own id, to tell its own chirp from everyone else's. */
  deviceId: string;
  isAudioOutput: boolean;
  clock: ClockSync;
  clockSynced: boolean;
  sendCalibration: (outputLatencyMs: number | null) => void;
  announceChirp: (payload: {
    chirpId: string;
    emitAtServerTime: number;
    startHz: number;
    endHz: number;
    durationMs: number;
  }) => void;
  sendChirpHeard: (payload: {
    chirpId: string;
    offsetMs: number;
    confidence: number;
  }) => void;
  onChirpScheduled: (handler: (a: ChirpAnnouncement) => void) => () => void;
  onChirpTurn: (handler: (t: ChirpTurn) => void) => () => void;
  startCalibrationRound: () => void;
}

export function useCalibration({
  deviceId,
  isAudioOutput,
  clock,
  clockSynced,
  sendCalibration,
  announceChirp,
  sendChirpHeard,
  onChirpScheduled,
  onChirpTurn,
  startCalibrationRound,
}: Args): CalibrationApi {
  const supported = isCalibrationSupported();
  const unsupportedReason = calibrationUnsupportedReason();

  const [status, setStatus] = useState<CalibrationStatus>(
    supported ? 'idle' : 'unsupported'
  );
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listenerOffsetMs, setListenerOffsetMs] = useState<number | null>(null);
  const [chirpBusy, setChirpBusy] = useState(false);
  const [activeTurn, setActiveTurn] = useState<ChirpTurn | null>(null);

  const runningRef = useRef(false);
  const autoTriedRef = useRef(false);

  // Restore a recent measurement so a reload doesn't mean recalibrating.
  useEffect(() => {
    if (!supported) return;
    const stored = loadStored();
    if (stored) {
      setResult(stored);
      setStatus('ok');
      sendCalibration(stored.outputLatencyMs);
    }
    // Intentionally once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  // --- Phase 1 -----------------------------------------------------------

  const calibrate = useCallback(async () => {
    if (runningRef.current) return;
    if (!supported) {
      setStatus('unsupported');
      setError(unsupportedReason);
      return;
    }

    runningRef.current = true;
    setStatus('running');
    setError(null);

    try {
      const measured = await runSelfCalibration();
      setResult(measured);
      setStatus('ok');
      saveStored(measured);
      sendCalibration(measured.outputLatencyMs);
    } catch (err) {
      const reason = err instanceof CalibrationError ? err.reason : 'failed';
      setStatus(reason === 'denied' ? 'denied' : reason === 'unsupported' ? 'unsupported' : 'failed');
      setError(err instanceof Error ? err.message : 'Calibration failed.');
      // A failed measurement must not leave a stale correction applied.
      sendCalibration(null);
    } finally {
      runningRef.current = false;
    }
  }, [supported, unsupportedReason, sendCalibration]);

  /**
   * Calibrate automatically on becoming the audio-output device.
   *
   * That transition usually follows a tap on "play audio on this device", which
   * is the user gesture iOS requires before it will start an AudioContext or
   * grant microphone access. When the role arrives without a local gesture —
   * because someone else handed it over — this attempt can fail, and the manual
   * Recalibrate button is the fallback.
   */
  useEffect(() => {
    if (!isAudioOutput || !supported) return;
    if (autoTriedRef.current || result !== null) return;
    autoTriedRef.current = true;
    void calibrate();
  }, [isAudioOutput, supported, result, calibrate]);

  // Losing the audio role means this device's speaker latency no longer applies
  // to the room, so stop advertising it.
  useEffect(() => {
    if (!isAudioOutput) autoTriedRef.current = false;
  }, [isAudioOutput]);

  const clear = useCallback(() => {
    setResult(null);
    setStatus(supported ? 'idle' : 'unsupported');
    setError(null);
    saveStored(null);
    sendCalibration(null);
  }, [supported, sendCalibration]);

  // --- Phase 2: emitting -------------------------------------------------

  const runChirpRound = useCallback(async () => {
    if (!isAudioOutput || chirpBusy) return;
    if (!clockSynced) {
      setError('Waiting for clock sync before a cross-device check.');
      return;
    }

    setChirpBusy(true);
    setError(null);

    const context = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();

    try {
      const chirpId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Announce first, then emit: listeners need time to open the microphone,
      // which on some devices takes a couple hundred milliseconds.
      announceChirp({
        chirpId,
        emitAtServerTime: clock.toServer(Date.now() + CHIRP_LEAD_MS),
        startHz: DEFAULT_CHIRP.startHz,
        endHz: DEFAULT_CHIRP.endHz,
        durationMs: DEFAULT_CHIRP.durationMs,
      });

      await emitChirp({ context, leadMs: CHIRP_LEAD_MS });
      await new Promise((r) => setTimeout(r, CHIRP_LEAD_MS + 200));
    } catch {
      setError('Could not emit the calibration tone.');
    } finally {
      await context.close().catch(() => undefined);
      setChirpBusy(false);
    }
  }, [isAudioOutput, chirpBusy, clockSynced, clock, announceChirp]);

  // --- Phase 2: listening ------------------------------------------------

  useEffect(() => {
    if (!supported) return;

    return onChirpScheduled((announcement) => {
      // Skip only our own emission — measuring that is the self-test's job.
      // Keying this off "am I an audio device" would have been wrong as soon as
      // more than one device produces sound: a non-emitting audio device still
      // needs to listen.
      if (announcement.fromDeviceId === deviceId) return;

      const expectedLocal = clock.toLocal(announcement.emitAtServerTime);
      const window = Math.max(300, expectedLocal - Date.now()) + LISTEN_TAIL_MS;

      void listenForChirp({
        spec: {
          startHz: announcement.startHz,
          endHz: announcement.endHz,
          durationMs: announcement.durationMs,
        },
        windowMs: window,
      })
        .then(({ arrivedAtLocal, confidence }) => {
          const offsetMs =
            clock.toServer(arrivedAtLocal) - announcement.emitAtServerTime;

          if (
            confidence < MIN_CALIBRATION_CONFIDENCE ||
            Math.abs(offsetMs) > MAX_CALIBRATION_OFFSET_MS
          ) {
            return;
          }

          setListenerOffsetMs(offsetMs);
          sendChirpHeard({ chirpId: announcement.chirpId, offsetMs, confidence });
        })
        .catch(() => {
          // Nothing heard. Calibration is an enhancement, so this is not an
          // error state — the device carries on with network-only sync.
        });
    });
  }, [supported, deviceId, clock, onChirpScheduled, sendChirpHeard]);

  // --- Mutual rounds -----------------------------------------------------

  /**
   * Take part in a mutual round.
   *
   * On its turn a device runs its own loopback measurement and announces the
   * chirp so everyone else can hear it too. The loopback is what produces the
   * latency figure: cross-device arrival times alone are underdetermined —
   * hearing another device tells you its output latency plus the air plus your
   * own input latency, which is three unknowns in one number. Each device's own
   * loopback separates its output path cleanly, and the cross-device readings
   * then serve as a sanity check on the result.
   */
  useEffect(() => {
    if (!supported) return;

    return onChirpTurn((turn) => {
      setActiveTurn(turn);
      // The server advances turns on a timer, so clear the badge a little after
      // this turn's own work should be done.
      window.setTimeout(() => {
        setActiveTurn((current) => (current?.turnIndex === turn.turnIndex ? null : current));
      }, 2800);

      if (turn.deviceId !== deviceId) return;

      // Tell the room when the tone will sound, then measure ourselves with it.
      announceChirp({
        chirpId: `${turn.roundId}:${turn.turnIndex}`,
        emitAtServerTime: clock.toServer(Date.now() + SCHEDULE_LEAD_MS),
        startHz: DEFAULT_CHIRP.startHz,
        endHz: DEFAULT_CHIRP.endHz,
        durationMs: DEFAULT_CHIRP.durationMs,
      });
      void calibrate();
    });
  }, [supported, deviceId, clock, onChirpTurn, announceChirp, calibrate]);

  return {
    supported,
    unsupportedReason,
    status,
    result,
    error,
    listenerOffsetMs,
    chirpBusy,
    calibrate,
    clear,
    runChirpRound,
    runMutualRound: startCalibrationRound,
    activeTurn,
  };
}
