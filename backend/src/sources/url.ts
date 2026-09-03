import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ResolvedSong } from '@tabjam/shared';
import { NO_TRACKS, ScoreSourceError, hasGpExtension } from './types.js';

/**
 * Fetch a Guitar Pro file from a direct URL the user supplies — a file on their
 * own NAS, a shared drive link, anywhere that serves the bytes over HTTP.
 *
 * Fetching happens server-side so the browser never hits a cross-origin URL,
 * which is the same reason the rest of the app proxies files through
 * /api/tab/:id/file.
 */

const REQUEST_TIMEOUT_MS = 20_000;

interface CachedFile {
  data: Buffer;
  filename: string;
  fetchedAt: number;
}

export class UrlSource {
  readonly kind = 'url' as const;

  /** id -> fetched file. In-memory only; a restart re-fetches on demand. */
  private readonly cache = new Map<string, CachedFile>();
  /** id -> original URL, so a cache miss can be recovered. */
  private readonly origins = new Map<string, string>();

  constructor(private readonly maxBytes: number) {}

  canHandle(reference: string): boolean {
    try {
      const url = new URL(reference.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      // Songsterr links are handled by the songsterr module, not here.
      if (/songsterr\.com/i.test(url.hostname)) return false;
      return true;
    } catch {
      return false;
    }
  }

  private static idFor(url: string): string {
    return `url_${createHash('sha1').update(url).digest('hex').slice(0, 12)}`;
  }

  async resolve(reference: string): Promise<ResolvedSong> {
    const url = reference.trim();
    const id = UrlSource.idFor(url);
    this.origins.set(id, url);

    // Fetch eagerly so a bad URL fails at "load song" rather than at playback.
    const { filename } = await this.download(id, url);
    const base = filename.replace(/\.[^.]+$/, '');
    const split = base.match(/^(.*?)\s+-\s+(.*)$/);

    return {
      id,
      title: split ? split[2].trim() : base,
      artist: split ? split[1].trim() : 'Unknown artist',
      source: 'url',
      fileUrl: `/api/tab/${id}/file`,
      tracks: NO_TRACKS,
      note: url,
    };
  }

  private async download(id: string, url: string): Promise<CachedFile> {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ScoreSourceError(
        `Could not fetch that URL (HTTP ${response.status}).`,
        502
      );
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > this.maxBytes) {
      throw new ScoreSourceError(
        `That file is larger than the ${Math.round(this.maxBytes / 1e6)}MB limit.`,
        413
      );
    }

    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength > this.maxBytes) {
      throw new ScoreSourceError(
        `That file is larger than the ${Math.round(this.maxBytes / 1e6)}MB limit.`,
        413
      );
    }

    const filename = UrlSource.filenameFrom(response, url);
    if (!hasGpExtension(filename)) {
      throw new ScoreSourceError(
        'That URL does not look like a Guitar Pro file (.gp, .gpx, .gp5, .gp4, .gp3).',
        415
      );
    }

    const entry: CachedFile = { data, filename, fetchedAt: Date.now() };
    this.cache.set(id, entry);
    return entry;
  }

  private static filenameFrom(response: Response, url: string): string {
    const disposition = response.headers.get('content-disposition');
    const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (match) return decodeURIComponent(match[1]);
    try {
      return path.basename(new URL(url).pathname) || 'score.gp';
    } catch {
      return 'score.gp';
    }
  }

  async fetchFile(id: string): Promise<{ data: Buffer; filename: string }> {
    const cached = this.cache.get(id);
    if (cached) return { data: cached.data, filename: cached.filename };

    const url = this.origins.get(id);
    if (!url) {
      throw new ScoreSourceError(
        'That remote file is no longer cached. Load the song again.',
        410
      );
    }
    const fetched = await this.download(id, url);
    return { data: fetched.data, filename: fetched.filename };
  }
}
