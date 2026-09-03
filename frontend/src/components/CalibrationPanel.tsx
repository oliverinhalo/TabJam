import type { CalibrationApi } from '../lib/useCalibration';

interface Props {
  calibration: CalibrationApi;
  isAudioOutput: boolean;
  clockSynced: boolean;
}

/**
 * Sync Check panel.
 *
 * Shows the measured latency and offers a manual re-run. Everything here is
 * optional: when the microphone is unavailable the panel explains why and the
 * app keeps working on network-only sync.
 */
export function CalibrationPanel({ calibration, isAudioOutput, clockSynced }: Props) {
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
        and headphones can add 100&ndash;300ms.
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

      {calibration.listenerOffsetMs !== null && (
        <p className="panel__hint">
          Heard the room&rsquo;s audio {Math.round(calibration.listenerOffsetMs)}ms
          after it was sent.
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
        Cross-device check only makes sense from the device making the sound,
        and it needs a clock estimate before the timings mean anything.
      */}
      {supported && isAudioOutput && (
        <button
          type="button"
          className="button button--ghost"
          disabled={calibration.chirpBusy || !clockSynced}
          onClick={() => void calibration.runChirpRound()}
          title={
            clockSynced
              ? 'Play a tone for the other devices to measure against'
              : 'Waiting for clock sync'
          }
        >
          {calibration.chirpBusy ? 'Playing tone…' : 'Check other devices'}
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
