import type { CalibrationApi } from '../lib/useCalibration';

interface Props {
  calibration: CalibrationApi;
  isAudioOutput: boolean;
  clockSynced: boolean;
  /** Slowest speaker in the room; the pace everyone aligns to. */
  referenceLatencyMs: number;
  /** How long this device waits to match that pace. */
  compensationMs: number;
  participantCount: number;
}

/**
 * Sync Check panel.
 *
 * Shows the measured latency and offers a manual re-run. Everything here is
 * optional: when the microphone is unavailable the panel explains why and the
 * app keeps working on network-only sync.
 */
export function CalibrationPanel({
  calibration,
  isAudioOutput,
  clockSynced,
  referenceLatencyMs,
  compensationMs,
  participantCount,
}: Props) {
  const { status, result, error, supported, unsupportedReason } = calibration;

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Sync check</h2>
        <StatusPill status={status} result={result} />
      </div>

      <p className="panel__hint">
        Measures the real delay from your speaker using this device&rsquo;s
        microphone — the part network timing can&rsquo;t see. Bluetooth speakers
        and headphones can add 100&ndash;300ms. The room then runs at the pace of
        its slowest device, and every quicker one waits to match.
      </p>

      {!supported && (
        <div className="alert alert--warn">
          <p>{unsupportedReason}</p>
          <p className="alert__hint">
            Sync still works without it — this only removes speaker delay.
          </p>
        </div>
      )}

      {error && status !== 'ok' && <div className="alert alert--error">{error}</div>}

      {result && (
        <dl className="metrics">
          <div>
            <dt>Speaker delay</dt>
            <dd>{Math.round(result.outputLatencyMs)} ms</dd>
          </div>
          <div>
            <dt>Measured round trip</dt>
            <dd>{Math.round(result.roundTripMs)} ms</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{result.confidence.toFixed(1)}</dd>
          </div>
        </dl>
      )}

      {referenceLatencyMs > 0 && (
        <dl className="metrics">
          <div>
            <dt>Room pace (slowest)</dt>
            <dd>{Math.round(referenceLatencyMs)} ms</dd>
          </div>
          <div>
            <dt>This device waits</dt>
            <dd>{Math.round(compensationMs)} ms</dd>
          </div>
        </dl>
      )}

      {calibration.listenerOffsetMs !== null && (
        <p className="panel__hint">
          Heard the room&rsquo;s audio {Math.round(calibration.listenerOffsetMs)}ms
          after it was sent.
        </p>
      )}

      {calibration.activeTurn && (
        <p className="panel__hint panel__hint--warn">
          Mutual check: device {calibration.activeTurn.turnIndex + 1} of{' '}
          {calibration.activeTurn.totalTurns} is playing its tone. Keep quiet.
        </p>
      )}

      {supported && (
        <div className="field field--row">
          <button
            type="button"
            className="button"
            disabled={status === 'running'}
            onClick={() => void calibration.calibrate()}
          >
            {status === 'running'
              ? 'Listening…'
              : result
                ? 'Recalibrate'
                : 'Run sync check'}
          </button>

          {result && (
            <button type="button" className="button button--ghost" onClick={calibration.clear}>
              Clear
            </button>
          )}
        </div>
      )}

      {/*
        The mutual round measures every device in turn, so it needs more than
        one device present and a clock estimate for the timings to mean anything.
      */}
      {supported && participantCount > 1 && (
        <button
          type="button"
          className="button button--ghost"
          disabled={calibration.activeTurn !== null || !clockSynced}
          onClick={calibration.runMutualRound}
          title={
            clockSynced
              ? 'Every device plays a tone in turn while the others listen'
              : 'Waiting for clock sync'
          }
        >
          {calibration.activeTurn ? 'Round in progress…' : 'Sync all devices'}
        </button>
      )}

      {supported && isAudioOutput && (
        <button
          type="button"
          className="button button--ghost"
          disabled={calibration.chirpBusy || !clockSynced}
          onClick={() => void calibration.runChirpRound()}
          title="Play one tone for the other devices to measure against"
        >
          {calibration.chirpBusy ? 'Playing tone…' : 'Play a test tone'}
        </button>
      )}
    </section>
  );
}

function StatusPill({
  status,
  result,
}: {
  status: CalibrationApi['status'];
  result: CalibrationApi['result'];
}) {
  if (status === 'ok' && result) {
    return (
      <span className="pill pill--ok">
        synced ✓ {Math.round(result.outputLatencyMs)}ms
      </span>
    );
  }
  if (status === 'running') return <span className="pill">measuring…</span>;
  if (status === 'denied') return <span className="pill pill--warn">mic denied</span>;
  if (status === 'unsupported') return <span className="pill pill--warn">unavailable</span>;
  if (status === 'failed') return <span className="pill pill--warn">failed</span>;
  return <span className="pill">not calibrated</span>;
}
