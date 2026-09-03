import type { ResolvedSong, TrackInfo } from '@tabjam/shared';

/**
 * A score source turns some user-supplied reference (an id, a URL, an uploaded
 * file) into a ResolvedSong plus the bytes of a Guitar Pro file that alphaTab
 * can parse.
 *
 * Sources are deliberately small and independent so one can be swapped or
 * added without touching the room/sync code.
 */
export interface ScoreSource {
  /** Matches ScoreSourceKind in @tabjam/shared. */
  readonly kind: 'library' | 'upload' | 'url';

  /** True if this source recognises the reference and should handle it. */
  canHandle(reference: string): boolean;

  /** Resolve a reference to song metadata. Throws ScoreSourceError on failure. */
  resolve(reference: string): Promise<ResolvedSong>;

  /** Return the Guitar Pro file bytes for a song id this source produced. */
  fetchFile(id: string): Promise<{ data: Buffer; filename: string }>;
}

/** Error type carrying an HTTP status so routes can map failures cleanly. */
export class ScoreSourceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly hint?: string
  ) {
    super(message);
    this.name = 'ScoreSourceError';
  }
}

/** Guitar Pro extensions alphaTab can parse. */
export const GP_EXTENSIONS = ['.gp', '.gpx', '.gp5', '.gp4', '.gp3'] as const;

export function hasGpExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return GP_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Empty track list placeholder — the real list comes from alphaTab client-side. */
export const NO_TRACKS: TrackInfo[] = [];
