import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResolvedSong, SongsterrMeta } from '@tabjam/shared';
import { ApiError, api, type LibraryFile } from '../lib/api';
import { formatBytes } from '../lib/format';

interface Props {
  current: ResolvedSong | null;
  history: ResolvedSong[];
  onLoad: (song: ResolvedSong) => void;
}

type SortKey = 'recent' | 'title' | 'artist';

/**
 * Choose what the room plays.
 *
 * Notation always comes from a Guitar Pro file you supply — dropped into the
 * library directory or added here. The Songsterr box is a lookup aid: it names
 * the song and lists its real track list so you can check a file against it,
 * but it cannot supply notation. See the README.
 */
export function SongLoader({ current, history, onLoad }: Props) {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
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
      setProgress(null);
    }
  };

  /**
   * Upload a whole selection at once.
   *
   * Sequential rather than parallel: a set of twenty files firing together
   * would just queue in the browser anyway, and one at a time means a failure
   * names the file that failed instead of losing the batch.
   */
  const handleUpload = (selected: FileList) =>
    run(async () => {
      const list = Array.from(selected);
      const failures: string[] = [];
      let lastSong: ResolvedSong | null = null;

      for (const [index, file] of list.entries()) {
        setProgress(`Adding ${index + 1} of ${list.length}: ${file.name}`);
        try {
          const { song } = await api.uploadToLibrary(file);
          lastSong = song;
        } catch (err) {
          failures.push(`${file.name} — ${err instanceof ApiError ? err.message : 'failed'}`);
        }
      }

      await refresh();
      if (failures.length > 0) {
        setError(`${failures.length} of ${list.length} could not be added.`);
        setHint(failures.slice(0, 3).join(' · '));
      }
      // Loading the last one is only helpful when a single file was added;
      // after a bulk import you want the list, not a surprise song change.
      if (lastSong && list.length === 1) onLoad(lastSong);
    });

  const handleLibraryPick = (id: string) =>
    run(async () => {
      const { song } = await api.resolveSong(id);
      onLoad(song);
    });

  const handleDelete = (file: LibraryFile) =>
    run(async () => {
      await api.deleteFromLibrary(file.id);
      await refresh();
    });

  /** Filter and order the library for display. */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? files.filter((f) =>
          `${f.title} ${f.artist} ${f.filename}`.toLowerCase().includes(needle)
        )
      : files;

    const ordered = [...matched];
    if (sort === 'title') ordered.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'artist') ordered.sort((a, b) => a.artist.localeCompare(b.artist));
    else ordered.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return ordered;
  }, [files, query, sort]);

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Songs</h2>
        <span className="panel__count">{files.length}</span>
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
      {progress && <div className="alert alert--warn">{progress}</div>}

      {/* --- Add files --------------------------------------------------- */}
      <div className="field">
        <span className="field__label">Add Guitar Pro files</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gp,.gpx,.gp5,.gp4,.gp3"
          multiple
          disabled={busy}
          onChange={(event) => {
            const selected = event.target.files;
            if (selected && selected.length > 0) void handleUpload(selected);
            event.target.value = '';
          }}
        />
        <p className="panel__hint">Select as many as you like at once.</p>
      </div>

      {/* --- Search and sort --------------------------------------------- */}
      {files.length > 0 && (
        <>
          <div className="field field--inline">
            <input
              type="text"
              placeholder="Search title, artist or file"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button type="button" className="button button--ghost" onClick={() => setQuery('')}>
                Clear
              </button>
            )}
          </div>

          <div className="field">
            <div className="segmented">
              {(['recent', 'title', 'artist'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={sort === key ? 'is-active' : ''}
                  onClick={() => setSort(key)}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          <ul className="library">
            {visible.map((file) => (
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
                <button
                  type="button"
                  className="tinybtn library__delete"
                  title={`Remove ${file.filename}`}
                  disabled={busy}
                  onClick={() => void handleDelete(file)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          {visible.length === 0 && (
            <p className="panel__hint">Nothing matches &ldquo;{query}&rdquo;.</p>
          )}
        </>
      )}

      {history.length > 0 && (
        <div className="field">
          <span className="field__label">Earlier this session</span>
          <ul className="library library--compact">
            {history.map((song) => (
              <li key={song.id}>
                <button type="button" className="library__pick" onClick={() => onLoad(song)}>
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
        tells you what the tracks <em>should</em> be — add a matching Guitar Pro
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
          <p className="panel__hint">
            Name your file <code>{meta.artist} - {meta.title}.gp5</code> and it will
            show up correctly in the list.
          </p>
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
