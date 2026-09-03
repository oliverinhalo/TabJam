import type { ResolvedSong, RoomState, SongsterrMeta } from '@tabjam/shared';

/** Thin REST client. Every path is same-origin, proxied to the backend in dev. */

export interface LibraryFile {
  id: string;
  filename: string;
  title: string;
  artist: string;
  modifiedAt: number;
  /** Parsed from the score itself; null when the file could not be read. */
  tempoBpm: number | null;
  key: string | null;
  barCount: number | null;
  trackCount: number | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      hint?: string;
    };
    throw new ApiError(
      body.error ?? `Request failed (${response.status})`,
      response.status,
      body.hint
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  createRoom: () => request<{ roomId: string; url: string }>('/rooms', { method: 'POST' }),

  getRoom: (roomId: string) => request<RoomState>(`/rooms/${roomId}`),

  listLibrary: () => request<{ files: LibraryFile[] }>('/library'),

  uploadToLibrary: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ song: ResolvedSong }>('/library', { method: 'POST', body: form });
  },

  deleteFromLibrary: (id: string) =>
    request<void>(`/library/${id}`, { method: 'DELETE' }),

  resolveSong: (reference: string) =>
    request<{ song: ResolvedSong }>('/songs/resolve', {
      method: 'POST',
      body: JSON.stringify({ reference }),
    }),

  /** Metadata only — see the note in the Songsterr panel. */
  lookupSongsterr: (query: string) =>
    request<{ meta: SongsterrMeta; notice: string }>(
      `/songsterr?q=${encodeURIComponent(query)}`
    ),
};
