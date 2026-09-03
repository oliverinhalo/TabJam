import type { ResolvedSong } from '@tabjam/shared';
import { LibrarySource } from './library.js';
import { UrlSource } from './url.js';
import { isSongsterrReference, lookupSongsterr } from './songsterr.js';
import { ScoreSourceError } from './types.js';

export { LibrarySource } from './library.js';
export { UrlSource } from './url.js';
export { ScoreSourceError } from './types.js';
export { lookupSongsterr, parseSongsterrId, isSongsterrReference } from './songsterr.js';

/**
 * Routes a user-supplied reference to whichever source can handle it, and
 * serves files back by id.
 */
export class SourceRegistry {
  constructor(
    readonly library: LibrarySource,
    readonly url: UrlSource
  ) {}

  /**
   * Resolve a reference typed into the "load a song" box.
   *
   * Songsterr references are intentionally rejected here with an explanatory
   * error rather than silently doing something else: Songsterr can identify a
   * song but cannot supply its notation (see sources/songsterr.ts). The HTTP
   * layer turns that into a lookup that returns metadata plus guidance, so the
   * UI can still help the user find the right file.
   */
  async resolve(reference: string): Promise<ResolvedSong> {
    const trimmed = reference.trim();
    if (!trimmed) {
      throw new ScoreSourceError('Enter a Songsterr link, a file URL, or pick a file.', 400);
    }

    if (isSongsterrReference(trimmed)) {
      throw new ScoreSourceError(
        'Songsterr can identify this song but cannot supply its notation.',
        409,
        'Use the Songsterr box to look up the track list, then load a matching Guitar Pro file from your library.'
      );
    }

    if (this.url.canHandle(trimmed)) {
      return this.url.resolve(trimmed);
    }

    // Bare ids fall through to the library.
    return this.library.resolve(trimmed);
  }

  /** Serve the Guitar Pro bytes for a previously resolved song id. */
  async fetchFile(id: string): Promise<{ data: Buffer; filename: string }> {
    if (id.startsWith('url_')) return this.url.fetchFile(id);
    return this.library.fetchFile(id);
  }
}

export { lookupSongsterr as songsterrLookup };
export type { LibraryEntry } from './library.js';
