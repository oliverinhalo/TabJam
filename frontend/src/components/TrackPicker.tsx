import type { TrackInfo } from '@tabjam/shared';

interface Props {
  tracks: TrackInfo[];
  selected: number[];
  onChange: (next: number[]) => void;
}

/**
 * Per-client track selection.
 *
 * This is deliberately local state and never synced: the whole point is that
 * the guitarist watches guitar while the drummer watches drums.
 */
export function TrackPicker({ tracks, selected, onChange }: Props) {
  if (tracks.length === 0) return null;

  const toggle = (index: number) => {
    onChange(
      selected.includes(index)
        ? selected.filter((i) => i !== index)
        : [...selected, index].sort((a, b) => a - b)
    );
  };

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Your tracks</h2>
        <div className="panel__actions">
          <button type="button" className="link" onClick={() => onChange([])}>
            All
          </button>
        </div>
      </div>
      <p className="panel__hint">Only affects your screen.</p>

      <ul className="tracklist">
        {tracks.map((track) => {
          const isOn = selected.length === 0 || selected.includes(track.index);
          return (
            <li key={track.index}>
              <label className={`track ${isOn ? 'track--on' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(track.index)}
                  onChange={() => toggle(track.index)}
                />
                <span className="track__name">{track.name}</span>
                {track.isDrums && <span className="badge">drums</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
