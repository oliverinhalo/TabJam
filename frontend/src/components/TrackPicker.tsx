import { useState } from 'react';
import {
  DEFAULT_TRACK_SETTINGS,
  MAX_CAPO_FRET,
  MAX_TRANSPOSE_SEMITONES,
  trackSettings,
  type RoomSettings,
  type TrackInfo,
  type TrackSettings,
} from '@tabjam/shared';
import { Stepper, formatSemitones } from './Stepper';

interface Props {
  tracks: TrackInfo[];
  /** Which tracks this device shows. Local, never synced. */
  selected: number[];
  onChange: (next: number[]) => void;
  settings: RoomSettings;
  onSettingsChange: (patch: Partial<RoomSettings>) => void;
}

/**
 * Track list and mixer.
 *
 * Two kinds of control live here and the split matters. Which tracks you *see*
 * is yours alone — the whole point is that the drummer watches drums while the
 * guitarist watches guitar. Everything else (mute, solo, volume, capo,
 * transpose) changes the music itself, so it is shared with the room.
 */
export function TrackPicker({
  tracks,
  selected,
  onChange,
  settings,
  onSettingsChange,
}: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (tracks.length === 0) return null;

  const toggleVisible = (index: number) => {
    onChange(
      selected.includes(index)
        ? selected.filter((i) => i !== index)
        : [...selected, index].sort((a, b) => a - b)
    );
  };

  /** Merge one track's settings into the shared map. */
  const patchTrack = (index: number, patch: Partial<TrackSettings>) => {
    const current = trackSettings(settings, index);
    onSettingsChange({
      tracks: {
        ...settings.tracks,
        [String(index)]: { ...current, ...patch },
      },
    });
  };

  const anySolo = Object.values(settings.tracks).some((t) => t.solo);

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Tracks</h2>
        <div className="panel__actions">
          <button type="button" className="link" onClick={() => onChange([])}>
            Show all
          </button>
        </div>
      </div>
      <p className="panel__hint">
        Ticks choose what <em>you</em> see. Mixer settings apply to everyone.
      </p>

      <ul className="tracklist">
        {tracks.map((track) => {
          const own = settings.tracks[String(track.index)] ?? DEFAULT_TRACK_SETTINGS;
          const isVisible = selected.length === 0 || selected.includes(track.index);
          const isOpen = expanded === track.index;
          // A soloed track elsewhere silences this one even when it isn't muted.
          const silenced = own.muted || (anySolo && !own.solo);

          return (
            <li key={track.index} className="trackrow">
              <div className={`track ${isVisible ? 'track--on' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(track.index)}
                  onChange={() => toggleVisible(track.index)}
                  title="Show this track on your screen"
                />
                <span className={`track__name ${silenced ? 'track__name--silenced' : ''}`}>
                  {track.name}
                </span>

                {own.capo > 0 && <span className="badge">capo {own.capo}</span>}
                {own.transposeSemitones !== 0 && (
                  <span className="badge">{formatSemitones(own.transposeSemitones)}</span>
                )}

                <button
                  type="button"
                  className={`tinybtn ${own.muted ? 'is-on' : ''}`}
                  onClick={() => patchTrack(track.index, { muted: !own.muted })}
                  title="Mute for everyone"
                >
                  M
                </button>
                <button
                  type="button"
                  className={`tinybtn ${own.solo ? 'is-on' : ''}`}
                  onClick={() => patchTrack(track.index, { solo: !own.solo })}
                  title="Solo for everyone"
                >
                  S
                </button>
                <button
                  type="button"
                  className="tinybtn"
                  onClick={() => setExpanded(isOpen ? null : track.index)}
                  aria-expanded={isOpen}
                  title="Capo, transpose and volume"
                >
                  {isOpen ? '▾' : '▸'}
                </button>
              </div>

              {isOpen && (
                <div className="trackrow__detail">
                  <Stepper
                    label="Capo"
                    value={own.capo}
                    min={0}
                    max={MAX_CAPO_FRET}
                    onChange={(capo) => patchTrack(track.index, { capo })}
                    format={(v) => (v === 0 ? 'none' : `fret ${v}`)}
                    title="Renumbers the frets to what you actually press. Does not change the pitch."
                  />
                  <Stepper
                    label="Transpose"
                    value={own.transposeSemitones}
                    min={-MAX_TRANSPOSE_SEMITONES}
                    max={MAX_TRANSPOSE_SEMITONES}
                    onChange={(transposeSemitones) =>
                      patchTrack(track.index, { transposeSemitones })
                    }
                    format={formatSemitones}
                    title="Shifts this track only, on top of the room-wide transpose."
                  />
                  <label className="field">
                    <span className="field__label">
                      Volume <b>{Math.round(own.volume * 100)}%</b>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={own.volume}
                      onChange={(event) =>
                        patchTrack(track.index, { volume: Number(event.target.value) })
                      }
                    />
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
