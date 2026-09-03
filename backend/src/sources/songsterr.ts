import type { SongsterrMeta, TrackInfo } from '@tabjam/shared';
import { ScoreSourceError } from './types.js';

/**
 * Songsterr metadata lookup.
 *
 * ---------------------------------------------------------------------------
 * IMPORTANT — what this module does and does not do
 * ---------------------------------------------------------------------------
 * This module resolves a Songsterr URL or song id to *metadata*: title, artist,
 * and the track list (instrument names, tunings, which track is drums/bass).
 * Those endpoints are plain public JSON and are what this module uses.
 *
 * It deliberately does NOT download notation data, because as of the last time
 * this was checked against the live site there is no publicly served Guitar Pro
 * file to download:
 *
 *   - Songsterr's player does not render from a .gp* file. It renders from an
 *     internal per-track format keyed by the `hash` on each track entry.
 *   - That data is served from an S3-backed host (gp.songsterr.com) which
 *     returns 403 AccessDenied to unauthenticated requests.
 *   - Guitar Pro appears in Songsterr's own client bundle only as an *import*
 *     feature ("replace the current tab with the contents of a Guitar Pro
 *     file") — there is no corresponding export/download route.
 *
 * Getting the notation would therefore mean defeating an access control rather
 * than fetching a public file, so TabJam does not do it. Notation comes from
 * Guitar Pro files you supply yourself — see sources/library.ts.
 *
 * Songsterr metadata is still genuinely useful here: it names the song and
 * gives you the track list to check your own file against, and it keeps the
 * "paste a Songsterr link" entry point in the UI working.
 *
 * These endpoints are unofficial and can change. If they do, this file is the
 * only one that needs updating.
 */

const SONGSTERR_ORIGIN = 'https://www.songsterr.com';
const USER_AGENT = 'TabJam/0.1 (self-hosted band practice tool)';
const REQUEST_TIMEOUT_MS = 10_000;

/** Revision entry from /api/meta/{songId}/revisions. */
interface SongsterrRevision {
  songId: number;
  revisionId: number;
  title?: string;
  artist?: string;
  isDeleted?: boolean;
  isBlocked?: boolean;
}

/** Track entry from /api/meta/{songId}/{revisionId}. */
interface SongsterrTrack {
  name?: string;
  instrument?: string;
  instrumentId?: number;
  tuning?: number[];
  isDrums?: boolean;
  isBassGuitar?: boolean;
  isGuitar?: boolean;
  isVocalTrack?: boolean;
  isEmpty?: boolean;
}

interface SongsterrRevisionMeta {
  songId: number;
  revisionId: number;
  title?: string;
  artist?: string;
  tracks?: SongsterrTrack[];
}

/**
 * Extract a numeric Songsterr song id from a URL or a bare id.
 *
 * Handles the shapes Songsterr uses today:
 *   https://www.songsterr.com/a/wsa/<slug>-tab-s27
 *   https://www.songsterr.com/a/wsa/<slug>-tab-s27t3   (t3 = track index)
 *   https://www.songsterr.com/a/wa/song?id=27
 *   27
 *
 * Returns null when the reference carries no id — the caller can then fall back
 * to scraping the page's embedded state for it.
 */
export function parseSongsterrId(reference: string): number | null {
  const trimmed = reference.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  // ...-s<songId> optionally followed by t<trackIndex>
  const slugMatch = trimmed.match(/-s(\d+)(?:t\d+)?(?:[/?#]|$)/i);
  if (slugMatch) return Number(slugMatch[1]);

  // Older ?id= form.
  try {
    const url = new URL(trimmed);
    const idParam = url.searchParams.get('id');
    if (idParam && /^\d+$/.test(idParam)) return Number(idParam);
  } catch {
    // Not a URL; fall through.
  }

  return null;
}

export function isSongsterrReference(reference: string): boolean {
  const trimmed = reference.trim();
  if (/^\d+$/.test(trimmed)) return true;
  return /(^|\/\/|\.)songsterr\.com/i.test(trimmed);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ScoreSourceError(
      `Songsterr responded ${response.status} for ${url}`,
      response.status === 404 ? 404 : 502
    );
  }
  return (await response.json()) as T;
}

/**
 * Pull the song id out of a Songsterr page that has no id in its URL, by
 * reading the app state Songsterr embeds in the HTML.
 */
async function scrapeSongIdFromPage(pageUrl: string): Promise<number | null> {
  const response = await fetch(pageUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;

  const html = await response.text();
  const stateMatch = html.match(
    /<script id="state" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!stateMatch) return null;

  try {
    const state = JSON.parse(stateMatch[1]) as {
      meta?: { songId?: number; current?: { songId?: number } };
    };
    return state.meta?.current?.songId ?? state.meta?.songId ?? null;
  } catch {
    return null;
  }
}

function toTrackInfo(track: SongsterrTrack, index: number): TrackInfo {
  return {
    index,
    name: track.name?.trim() || track.instrument || `Track ${index + 1}`,
    instrument: track.instrument,
    instrumentId: track.instrumentId,
    tuning: track.tuning,
    isDrums: track.isDrums ?? false,
    isBass: track.isBassGuitar ?? false,
    isGuitar: track.isGuitar ?? false,
    isVocals: track.isVocalTrack ?? false,
  };
}

/**
 * Look up a song on Songsterr and return its metadata and track list.
 *
 * Returns metadata only. See the note at the top of this file for why there is
 * no accompanying notation download.
 */
export async function lookupSongsterr(reference: string): Promise<SongsterrMeta> {
  let songId = parseSongsterrId(reference);

  if (songId === null && /songsterr\.com/i.test(reference)) {
    songId = await scrapeSongIdFromPage(reference.trim());
  }

  if (songId === null) {
    throw new ScoreSourceError(
      'Could not find a Songsterr song id in that reference.',
      400,
      'Paste a full Songsterr song URL (it ends in something like "-tab-s27") or just the numeric id.'
    );
  }

  // Newest non-deleted revision wins; that is what the site itself shows.
  const revisions = await getJson<SongsterrRevision[]>(
    `${SONGSTERR_ORIGIN}/api/meta/${songId}/revisions`
  );
  const usable = revisions.filter((r) => !r.isDeleted && !r.isBlocked);
  if (usable.length === 0) {
    throw new ScoreSourceError(
      `Songsterr has no available revision for song ${songId}.`,
      404
    );
  }
  const latest = usable.reduce((a, b) => (b.revisionId > a.revisionId ? b : a));

  const meta = await getJson<SongsterrRevisionMeta>(
    `${SONGSTERR_ORIGIN}/api/meta/${songId}/${latest.revisionId}`
  );

  const tracks = (meta.tracks ?? [])
    .map(toTrackInfo)
    // Empty tracks exist in some transcriptions and are noise in a picker.
    .filter((_, i) => !(meta.tracks?.[i]?.isEmpty ?? false));

  return {
    songId,
    revisionId: latest.revisionId,
    title: meta.title ?? latest.title ?? `Song ${songId}`,
    artist: meta.artist ?? latest.artist ?? 'Unknown artist',
    tracks,
    pageUrl: `${SONGSTERR_ORIGIN}/a/wsa/-tab-s${songId}`,
  };
}
