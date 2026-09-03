import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ResolvedSong } from '@tabjam/shared';
import { GP_EXTENSIONS, NO_TRACKS, ScoreSourceError, hasGpExtension } from './types.js';
import { EMPTY_METADATA, readMetadata, type ScoreMetadata } from './metadata.js';

/**
 * Guitar Pro files that live on this server.
 *
 * Two ways in:
 *   - drop files into LIBRARY_DIR (mounted from ./data/library by compose)
 *   - upload through the UI, which writes into the same directory
 *
 * This is the source that actually provides notation. Ids are derived from the
 * file path so they survive a restart without needing a database.
 */

export interface LibraryEntry extends ScoreMetadata {
  id: string;
  filename: string;
  title: string;
  artist: string;
  modifiedAt: number;
}

export class LibrarySource {
  readonly kind = 'library' as const;

  /**
   * Parsed metadata, keyed by filename and invalidated by modification time.
   *
   * Parsing every score on every listing would mean re-reading the whole
   * library each time the panel opens, which is wasteful for files that have
   * not changed.
   */
  private readonly metadataCache = new Map<
    string,
    { modifiedAt: number; metadata: ScoreMetadata }
  >();

  constructor(private readonly libraryDir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.libraryDir, { recursive: true });
  }

  /** Deterministic id for a filename, so links stay valid across restarts. */
  private idFor(filename: string): string {
    return createHash('sha1').update(filename).digest('hex').slice(0, 12);
  }

  /**
   * Resolve an id back to a real path inside the library directory.
   * Rebuilds from the directory listing rather than trusting client input, so
   * a crafted id can never escape the library directory.
   */
  private async pathForId(id: string): Promise<string | null> {
    const files = await this.listFilenames();
    const match = files.find((f) => this.idFor(f) === id);
    return match ? path.join(this.libraryDir, match) : null;
  }

  private async listFilenames(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.libraryDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && hasGpExtension(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  /**
   * Guess title and artist from the filename.
   * "Led Zeppelin - Stairway to Heaven.gp5" -> artist / title.
   * Anything without a separator becomes the title with an unknown artist.
   */
  private static parseName(filename: string): { title: string; artist: string } {
    const base = filename.replace(/\.[^.]+$/, '').trim();
    const split = base.match(/^(.*?)\s+-\s+(.*)$/);
    if (split) {
      return { artist: split[1].trim(), title: split[2].trim() };
    }
    return { artist: 'Unknown artist', title: base };
  }

  /** Parse a file's tempo and key, reusing the cached result when unchanged. */
  private async metadataFor(filename: string, modifiedAt: number): Promise<ScoreMetadata> {
    const cached = this.metadataCache.get(filename);
    if (cached && cached.modifiedAt === modifiedAt) return cached.metadata;

    try {
      const data = await fs.readFile(path.join(this.libraryDir, filename));
      const metadata = readMetadata(data);
      this.metadataCache.set(filename, { modifiedAt, metadata });
      return metadata;
    } catch {
      return EMPTY_METADATA;
    }
  }

  async list(): Promise<LibraryEntry[]> {
    const filenames = await this.listFilenames();
    const entries = await Promise.all(
      filenames.map(async (filename) => {
        const stat = await fs.stat(path.join(this.libraryDir, filename));
        const { title, artist } = LibrarySource.parseName(filename);
        return {
          id: this.idFor(filename),
          filename,
          title,
          artist,
          modifiedAt: stat.mtimeMs,
          ...(await this.metadataFor(filename, stat.mtimeMs)),
        };
      })
    );
    return entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  async resolve(id: string): Promise<ResolvedSong> {
    const filePath = await this.pathForId(id);
    if (!filePath) {
      throw new ScoreSourceError('No file in the library with that id.', 404);
    }
    const filename = path.basename(filePath);
    const { title, artist } = LibrarySource.parseName(filename);
    return {
      id,
      title,
      artist,
      source: 'library',
      fileUrl: `/api/tab/${id}/file`,
      tracks: NO_TRACKS,
      note: filename,
    };
  }

  async fetchFile(id: string): Promise<{ data: Buffer; filename: string }> {
    const filePath = await this.pathForId(id);
    if (!filePath) {
      throw new ScoreSourceError('No file in the library with that id.', 404);
    }
    return { data: await fs.readFile(filePath), filename: path.basename(filePath) };
  }

  /**
   * Save an uploaded Guitar Pro file into the library.
   * Collisions get a numeric suffix rather than overwriting.
   */
  async save(originalName: string, data: Buffer): Promise<ResolvedSong> {
    if (!hasGpExtension(originalName)) {
      throw new ScoreSourceError(
        `Unsupported file type. Supported: ${GP_EXTENSIONS.join(', ')}`,
        415
      );
    }

    // Strip any directory components a client might have sent.
    const safeName = path.basename(originalName).replace(/[/\\]/g, '_');
    const filename = await this.uniqueName(safeName);
    await fs.writeFile(path.join(this.libraryDir, filename), data);
    return this.resolve(this.idFor(filename));
  }

  private async uniqueName(name: string): Promise<string> {
    const existing = new Set(await this.listFilenames());
    if (!existing.has(name)) return name;

    const ext = path.extname(name);
    const stem = name.slice(0, -ext.length);
    for (let n = 2; n < 1000; n++) {
      const candidate = `${stem} (${n})${ext}`;
      if (!existing.has(candidate)) return candidate;
    }
    throw new ScoreSourceError('Too many files with that name.', 409);
  }

  async delete(id: string): Promise<void> {
    const filePath = await this.pathForId(id);
    if (!filePath) throw new ScoreSourceError('No file in the library with that id.', 404);
    await fs.unlink(filePath);
  }
}
