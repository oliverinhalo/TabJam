import { useTuner } from '../lib/useTuner';

/** Within this many cents counts as in tune — about what an ear accepts. */
const IN_TUNE_CENTS = 5;

/**
 * Microphone tuner.
 *
 * Local to the device and holds the microphone only while running, so it does
 * not sit open through a whole practice.
 */
export function TunerPanel() {
  const tuner = useTuner();
  const { reading } = tuner;
  const inTune = reading !== null && Math.abs(reading.cents) <= IN_TUNE_CENTS;

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Tuner</h2>
        {tuner.running && <span className="pill">listening</span>}
      </div>

      {tuner.error && <div className="alert alert--error">{tuner.error}</div>}

      {tuner.running && (
        <div className={`tuner ${inTune ? 'tuner--intune' : ''}`}>
          <div className="tuner__note">{reading ? reading.name : '—'}</div>
          <div className="tuner__cents">
            {reading ? `${reading.cents > 0 ? '+' : ''}${reading.cents} cents` : 'play a note'}
          </div>

          {/* Needle: centre is in tune, left is flat, right is sharp. */}
          <div className="tuner__meter">
            <div className="tuner__centre" />
            <div
              className="tuner__needle"
              style={{
                // Clamped so a wildly wrong note pins to the edge rather than
                // sliding out of the meter.
                left: `${50 + Math.max(-50, Math.min(50, (reading?.cents ?? 0) * 1)) }%`,
                opacity: reading ? 1 : 0.25,
              }}
            />
          </div>
          <div className="tuner__scale">
            <span>♭</span>
            <span>{reading ? `${reading.frequencyHz.toFixed(1)} Hz` : ''}</span>
            <span>♯</span>
          </div>
        </div>
      )}

      {tuner.supported ? (
        <button
          type="button"
          className={tuner.running ? 'button button--ghost' : 'button'}
          onClick={() => (tuner.running ? tuner.stop() : void tuner.start())}
        >
          {tuner.running ? 'Stop tuner' : 'Start tuner'}
        </button>
      ) : (
        <p className="panel__hint">
          Needs microphone access over HTTPS.
        </p>
      )}
    </section>
  );
}
