import { MAX_TRANSPOSE_SEMITONES, type RoomSettings } from '@tabjam/shared';
import { primeSpeech } from '../lib/metronome';
import { Stepper, formatSemitones } from './Stepper';

interface Props {
  settings: RoomSettings;
  onChange: (patch: Partial<RoomSettings>) => void;
  /** Bars in the loaded score, for bounding the loop range. */
  barCount: number;
}

/** Room-wide settings. Every control here changes things for everyone. */
export function SettingsPanel({ settings, onChange, barCount }: Props) {
  const loop = settings.loopRange;
  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Room settings</h2>
      </div>
      <p className="panel__hint">Shared — these apply for everyone.</p>


      <div className="field">
        <span className="field__label">Metronome</span>
        <div className="segmented">
          {(['off', 'click', 'spoken'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={settings.metronome === mode ? 'is-active' : ''}
              onClick={() => {
                // Browsers gate speech behind a gesture; this click is one.
                if (mode === 'spoken') primeSpeech();
                onChange({ metronome: mode });
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <Stepper
        label="Transpose"
        value={settings.transposeSemitones}
        min={-MAX_TRANSPOSE_SEMITONES}
        max={MAX_TRANSPOSE_SEMITONES}
        onChange={(transposeSemitones) => onChange({ transposeSemitones })}
        format={formatSemitones}
        title="Shifts the whole room. Per-track shifts add on top, in the track list."
      />

      <label className="field">
        <span className="field__label">
          Speed <b>{Math.round(settings.playbackSpeed * 100)}%</b>
        </span>
        <input
          type="range"
          min={0.25}
          max={2}
          step={0.05}
          value={settings.playbackSpeed}
          onChange={(event) => onChange({ playbackSpeed: Number(event.target.value) })}
        />
      </label>

      <div className="field field--row">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.loop}
            onChange={(event) => onChange({ loop: event.target.checked })}
            disabled={loop !== null}
          />
          <span>Loop all</span>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.countInBars > 0}
            onChange={(event) => onChange({ countInBars: event.target.checked ? 1 : 0 })}
          />
          <span>Count-in</span>
        </label>
      </div>

      {/* Drilling one passage is most of what practice actually is. */}
      <div className="field">
        <span className="field__label">
          Loop section {loop && <b>bars {loop.startBar}&ndash;{loop.endBar}</b>}
        </span>
        {loop ? (
          <div className="looprange">
            <Stepper
              label="From"
              value={loop.startBar}
              min={1}
              max={Math.max(1, barCount)}
              onChange={(startBar) =>
                onChange({ loopRange: { startBar, endBar: Math.max(startBar, loop.endBar) } })
              }
            />
            <Stepper
              label="To"
              value={loop.endBar}
              min={1}
              max={Math.max(1, barCount)}
              onChange={(endBar) =>
                onChange({ loopRange: { startBar: Math.min(loop.startBar, endBar), endBar } })
              }
            />
            <button
              type="button"
              className="button button--ghost"
              onClick={() => onChange({ loopRange: null })}
            >
              Clear section
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button button--ghost"
            disabled={barCount === 0}
            onClick={() =>
              onChange({ loopRange: { startBar: 1, endBar: Math.min(4, barCount) } })
            }
          >
            {barCount === 0 ? 'Load a song first' : 'Loop a section'}
          </button>
        )}
      </div>

    </section>
  );
}
