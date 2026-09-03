/**
 * Types shared between the TabJam backend and frontend.
 *
 * Everything here is transport-level: the shapes that travel over HTTP or the
 * Socket.io connection. Anything purely local to one side stays out.
 */

// ---------------------------------------------------------------------------
// Songs and tracks
// ---------------------------------------------------------------------------

/** One playable track inside a score, as advertised to clients. */
export interface TrackInfo {
  /** Index of the track within the score. Stable for a given score. */
  index: number;
  /** Display name, e.g. "Rhythm Guitar". */
  name: string;
  /** General MIDI instrument name when known, e.g. "Overdriven Guitar". */
  instrument?: string;
  /** MIDI program number when known. */
  instrumentId?: number;
  /** String tunings as MIDI note numbers, high string first. Empty for drums. */
  tuning?: number[];
  isDrums?: boolean;
  isBass?: boolean;
  isGuitar?: boolean;
  isVocals?: boolean;
}

/** Where a score's notation data came from. */
export type ScoreSourceKind = 'library' | 'upload' | 'url';

/**
 * A score that has been resolved to something the frontend can actually load.
 * `fileUrl` is always served by this app, never a third-party URL, so the
 * browser never has to deal with cross-origin fetches.
 */
export interface ResolvedSong {
  /** Stable id used in /api/tab/:id/file. */
  id: string;
  title: string;
  artist: string;
  source: ScoreSourceKind;
  /** Relative URL on this server that serves the Guitar Pro file. */
  fileUrl: string;
  /**
   * Track list. Populated from the score file itself once alphaTab parses it;
   * the server fills in whatever it knows up front, which may be an empty list.
   */
  tracks: TrackInfo[];
  /** Free-form provenance note shown in the UI (e.g. a Songsterr link). */
  note?: string;
}

/**
 * Metadata looked up from Songsterr. Deliberately separate from ResolvedSong:
 * this identifies a song and lists its tracks, but carries no notation data.
 * See backend/src/sources/songsterr.ts for why.
 */
export interface SongsterrMeta {
  songId: number;
  revisionId: number;
  title: string;
  artist: string;
  tracks: TrackInfo[];
  /** Canonical songsterr.com page for the song. */
  pageUrl: string;
}

// ---------------------------------------------------------------------------
// Room state
// ---------------------------------------------------------------------------

export type MetronomeMode = 'off' | 'click' | 'spoken';

export interface TransportState {
  isPlaying: boolean;
  tempoBpm: number;
  /**
   * Playback position in milliseconds from the start of the score.
   * Milliseconds rather than ticks: alphaTab reports and seeks in ms, and it
   * survives tempo changes without needing the tick->time map on every client.
   */
  positionMs: number;
  /** Server clock (epoch ms) when positionMs was last set. */
  updatedAt: number;
}

export interface RoomSettings {
  /** 0..1 */
  masterVolume: number;
  metronome: MetronomeMode;
  /** Semitones, negative or positive. */
  transposeSemitones: number;
  /** Playback rate multiplier, 0.25..2. */
  playbackSpeed: number;
  /** Whether playback loops the whole score. */
  loop: boolean;
  /** Count-in bars before playback starts. 0 disables it. */
  countInBars: number;
}

export interface Participant {
  deviceId: string;
  name: string;
  connectedAt: number;
  /** True while this device has an open socket. */
  online: boolean;
}

export interface RoomState {
  roomId: string;
  song: ResolvedSong | null;
  /** Songs previously loaded into this room, most recent first. */
  history: ResolvedSong[];
  transport: TransportState;
  settings: RoomSettings;
  /** deviceId of the device producing sound, or null if nobody claimed it. */
  audioOutputDeviceId: string | null;
  participants: Participant[];
}

// ---------------------------------------------------------------------------
// Socket.io events
// ---------------------------------------------------------------------------

/** Events the client sends to the server. */
export interface ClientToServerEvents {
  join: (
    payload: { roomId: string; deviceId: string; name: string },
    ack: (result: { ok: true; state: RoomState } | { ok: false; error: string }) => void
  ) => void;

  rename: (payload: { name: string }) => void;

  /** Load a different song into the room, replacing the active one. */
  loadSong: (
    payload: { song: ResolvedSong },
    ack?: (result: { ok: boolean; error?: string }) => void
  ) => void;

  play: (payload: { positionMs?: number }) => void;
  pause: (payload: { positionMs: number }) => void;
  seek: (payload: { positionMs: number }) => void;

  /**
   * Position report from the audio-output device, used to correct drift on
   * everyone else. Ignored from any device that is not the audio output.
   */
  positionReport: (payload: { positionMs: number; isPlaying: boolean }) => void;

  updateSettings: (payload: Partial<RoomSettings>) => void;

  /** Claim the audio-output role for this device. */
  claimAudioOutput: () => void;
  /** Give up the audio-output role, if this device holds it. */
  releaseAudioOutput: () => void;
}

/** Events the server sends to clients. */
export interface ServerToClientEvents {
  /** Full snapshot. Sent on join and after disruptive changes. */
  state: (state: RoomState) => void;
  transport: (transport: TransportState) => void;
  settings: (settings: RoomSettings) => void;
  participants: (participants: Participant[]) => void;
  song: (payload: { song: ResolvedSong | null; history: ResolvedSong[] }) => void;
  audioOutput: (payload: { audioOutputDeviceId: string | null }) => void;
  /** Transient, human-readable notice to surface in the UI. */
  notice: (payload: { level: 'info' | 'warn' | 'error'; message: string }) => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: RoomSettings = {
  masterVolume: 0.8,
  metronome: 'off',
  transposeSemitones: 0,
  playbackSpeed: 1,
  loop: false,
  countInBars: 0,
};

export const DEFAULT_TRANSPORT: TransportState = {
  isPlaying: false,
  tempoBpm: 120,
  positionMs: 0,
  updatedAt: 0,
};

/**
 * How stale a non-audio client's interpolated cursor may get before it snaps to
 * the last reported position. Generous on purpose: a scrolling highlight only
 * needs to be right to about a bar.
 */
export const POSITION_REPORT_INTERVAL_MS = 500;
export const MAX_INTERPOLATION_DRIFT_MS = 1500;
