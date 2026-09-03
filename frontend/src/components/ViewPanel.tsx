import type { Preferences } from '../lib/usePreferences';

interface Props {
  preferences: Preferences;
  onChange: (patch: Partial<Preferences>) => void;
}

/**
 * How this device draws the score.
 *
 * Separate from Room settings on purpose: nothing here touches the music or
 * anybody else's screen. The singer can read standard notation while the
 * guitarist reads tab, off the same file, at the same time.
 */
export function ViewPanel({ preferences, onChange }: Props) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Your device</h2>
      </div>
      <p className="panel__hint">Only affects this device.</p>

      <div className="field">
        <span className="field__label">Show</span>
        <div className="toggles">
          <Toggle
            label="Notation"
            on={preferences.showScore}
            onClick={() => onChange({ showScore: !preferences.showScore })}
            title="Standard notation staff"
          />
          <Toggle
            label="Tab"
            on={preferences.showTab}
            onClick={() => onChange({ showTab: !preferences.showTab })}
            title="Tablature staff"
          />
          <Toggle
            label="Chords"
            on={preferences.showChords}
            onClick={() => onChange({ showChords: !preferences.showChords })}
            title="Chord names and diagrams"
          />
        </div>
      </div>

      <label className="field">
        <span className="field__label">
          Volume <b>{Math.round(preferences.volume * 100)}%</b>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={preferences.volume}
          onChange={(event) => onChange({ volume: Number(event.target.value) })}
        />
      </label>

      <label className="field">
        <span className="field__label">
          Zoom <b>{Math.round(preferences.zoom * 100)}%</b>
        </span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={preferences.zoom}
          onChange={(event) => onChange({ zoom: Number(event.target.value) })}
        />
      </label>
    </section>
  );
}

function Toggle({
  label,
  on,
  onClick,
  title,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      className={`toggle ${on ? 'is-on' : ''}`}
      onClick={onClick}
      aria-pressed={on}
      title={title}
    >
      {label}
    </button>
  );
}
