import type { RoomSettings } from '@tabjam/shared';
import { primeSpeech } from '../lib/metronome';

interface Props {
  settings: RoomSettings;
  onChange: (patch: Partial<RoomSettings>) => void;
}

/** Room-wide settings. Every control here changes things for everyone. */
export function SettingsPanel({ settings, onChange }: Props) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Room settings</h2>
      </div>
      <p className="panel__hint">Shared — these apply for everyone.</p>

      <label className="field">
        <span className="field__label">
          Volume <b>{Math.round(settings.masterVolume * 100)}%</b>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.masterVolume}
          onChange={(event) => onChange({ masterVolume: Number(event.target.value) })}
        />
      </label>

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

      <label className="field">
        <span className="field__label">
          Transpose{' '}
          <b>
            {settings.transposeSemitones > 0 ? '+' : ''}
            {settings.transposeSemitones}
          </b>
        </span>
        <input
          type="range"
          min={-12}
          max={12}
          step={1}
          value={settings.transposeSemitones}
          onChange={(event) =>
            onChange({ transposeSemitones: Number(event.target.value) })
          }
        />
      </label>

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
          />
          <span>Loop</span>
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
    </section>
  );
}
