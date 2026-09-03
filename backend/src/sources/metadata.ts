import { importer } from '@coderline/alphatab';

/**
 * Read tempo and key out of a Guitar Pro file.
 *
 * alphaTab's importer runs perfectly well outside a browser, so the same parser
 * the frontend renders with can pull the handful of facts worth showing in a
 * song list. Anything unreadable simply comes back empty — a file that will not
 * parse is still worth listing, and the player will report the real problem.
 */

export interface ScoreMetadata {
  /** Beats per minute at the start of the score. */
  tempoBpm: number | null;
  /** Readable key, e.g. "G" or "Em". */
  key: string | null;
  barCount: number | null;
  trackCount: number | null;
}

export const EMPTY_METADATA: ScoreMetadata = {
  tempoBpm: null,
  key: null,
  barCount: null,
  trackCount: null,
};

// Keys by number of sharps (positive) or flats (negative), -7..7.
const MAJOR_KEYS = ['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'];
const MINOR_KEYS = ['Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#','G#','D#','A#'];

function keyName(signature: number, isMinor: boolean): string | null {
  const index = signature + 7;
  if (index < 0 || index >= MAJOR_KEYS.length) return null;
  return isMinor ? `${MINOR_KEYS[index]}m` : MAJOR_KEYS[index];
}

export function readMetadata(data: Buffer): ScoreMetadata {
  try {
    const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(data));
    const first = score.masterBars[0];

    return {
      tempoBpm: Math.round(score.tempo) || null,
      // keySignatureType is 0 for major, 1 for minor.
      key: first ? keyName(first.keySignature, first.keySignatureType === 1) : null,
      barCount: score.masterBars.length,
      trackCount: score.tracks.length,
    };
  } catch {
    return EMPTY_METADATA;
  }
}
