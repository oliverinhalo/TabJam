import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResolvedSong, SongsterrMeta } from '@tabjam/shared';
import { ApiError, api, type LibraryFile } from '../lib/api';
import { formatBytes } from '../lib/format';

interface Props {
  current: ResolvedSong | null;
  history: ResolvedSong[];
  onLoad: (song: ResolvedSong) => void;
}

/**
 * Choose what the room plays.
 *
 * Notation always comes from a Guitar Pro file you supply — uploaded here or
 * dropped into the library directory. The Songsterr box is a lookup aid: it
 * names the song and lists its real track list so you can check a file against
 * it, but it cannot supply notation. See the panel text and the README.
 */
export function SongLoader({ current, history, onLoad }: Props) {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const { files: next } = await api.listLibrary();
      setFiles(next);
    } catch {
      // A failed refresh is not worth interrupting the session over.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      await task();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setHint(err.hint ?? null);
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = (file: File) =>
    run(async () => {
      const { song } = await api.uploadToLibrary(file);
      await refresh();
      onLoad(song);
    });

  const handleLibraryPick = (id: string) =>
    run(async () => {
      const { song } = await api.resolveSong(id);
      onLoad(song);
    });

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Song</h2>
      </div>

      {current && (
        <div className="nowplaying">
          <div className="nowplaying__title">{current.title}</div>
          <div className="nowplaying__artist">{current.artist}</div>
        </div>
      )}

      {error && (
        <div className="alert alert--error">
          <p>{error}</p>
          {hint && <p className="alert__hint">{hint}</p>}
        </div>
      )}

      {/* --- Upload ------------------------------------------------------ */}
      <div className="field">
        <span className="field__label">Add a Guitar Pro file</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gp,.gpx,.gp5,.gp4,.gp3"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleUpload(file);
            event.target.value = '';
          }}
        />
      </div>

      {/* --- Library ----------------------------------------------------- */}
      {files.length > 0 && (
        <div className="field">
          <span className="field__label">Library</span>
          <ul className="library">
            {files.map((file) => (
              <li key={file.id} className={current?.id === file.id ? 'is-current' : ''}>
                <button
                  type="button"
                  className="library__pick"
                  disabled={busy}
                  onClick={() => void handleLibraryPick(file.id)}
                >
                  <span className="library__title">{file.title}</span>
                  <span className="library__meta">
                    {file.artist} · {formatBytes(file.sizeBytes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <div className="field">
          <span className="field__label">Earlier this session</span>
          <ul className="library library--compact">
            {history.map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  className="library__pick"
                  onClick={() => onLoad(song)}
                >
                  <span className="library__title">{song.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SongsterrLookup />
    </section>
  );
}

/**
 * Songsterr metadata lookup.
 *
 * Kept visually separate from the loading controls precisely because it does
 * not load anything — it identifies a song and shows its track list.
 */
function SongsterrLookup() {
  const [query, setQuery] = useState('');
  const [meta, setMeta] = useState<SongsterrMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    setMeta(null);
    try {
      const result = await api.lookupSongsterr(query);
      setMeta(result.meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lookup failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="songsterr">
      <summary>Look up a Songsterr track list</summary>

      <p className="panel__hint">
        Metadata only. Songsterr does not publicly serve the notation, so this
        tells you what the tracks <em>should</em> be — load a matching Guitar Pro
        file above to actually play it.
      </p>

      <div className="field field--inline">
        <input
          type="text"
          placeholder="Songsterr URL or song id"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void lookup();
          }}
        />
        <button type="button" className="button" disabled={busy} onClick={() => void lookup()}>
          {busy ? '…' : 'Look up'}
        </button>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {meta && (
        <div className="songsterr__result">
          <div className="nowplaying__title">{meta.title}</div>
          <div className="nowplaying__artist">{meta.artist}</div>
          <ol className="songsterr__tracks">
            {meta.tracks.map((track) => (
              <li key={track.index}>
                {track.name}
                {track.instrument && <span className="dim"> · {track.instrument}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </details>
  );
}
