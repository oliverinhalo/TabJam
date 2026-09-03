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

/**
 * Per-track settings, shared with the room.
 *
 * Keyed by track index in RoomSettings.tracks. Absent entries mean defaults,
 * so a room that has never touched a track carries nothing for it.
 */
export interface TrackSettings {
  /**
   * Semitone shift for this track alone, added to the room-wide transpose.
   * Use this when one instrument needs shifting and the rest do not.
   */
  transposeSemitones: number;
  /**
   * Capo position in frets.
   *
   * Distinct from transposing: a capo leaves the sounding pitch alone and
   * renumbers the frets, so a part written at fret 5 reads as fret 3 with a
   * capo on 2 — what the player actually has to press.
   */
  capo: number;
  muted: boolean;
  solo: boolean;
  /** 0..1 */
  volume: number;
}

export const DEFAULT_TRACK_SETTINGS: TrackSettings = {
  transposeSemitones: 0,
  capo: 0,
  muted: false,
  solo: false,
  volume: 1,
};

/** Bar range to loop over, 1-based and inclusive. */
export interface LoopRange {
  startBar: number;
  endBar: number;
}

export interface RoomSettings {
  metronome: MetronomeMode;
  /** Semitones, negative or positive. */
  transposeSemitones: number;
  /** Playback rate multiplier, 0.25..2. */
  playbackSpeed: number;
  /** Whether playback loops the whole score. */
  loop: boolean;
  /** Count-in bars before playback starts. 0 disables it. */
  countInBars: number;
  /**
   * Per-track overrides, keyed by track index as a string.
   * Sparse: only tracks somebody has changed appear here.
   */
  tracks: Record<string, TrackSettings>;
  /** Bars to loop between, or null to play the whole score. */
  loopRange: LoopRange | null;
}

export interface Participant {
  deviceId: string;
  name: string;
  connectedAt: number;
  /** True while this device has an open socket. */
  online: boolean;
  /**
   * Measured speaker output latency in ms, from acoustic calibration.
   * null when the device has not calibrated (or could not).
   */
  outputLatencyMs: number | null;
}

export interface RoomState {
  roomId: string;
  song: ResolvedSong | null;
  /** Songs previously loaded into this room, most recent first. */
  history: ResolvedSong[];
  transport: TransportState;
  settings: RoomSettings;
  /**
   * Devices currently producing sound. More than one is allowed: with
   * calibration in place their outputs are delayed to emerge together.
   */
  audioOutputDeviceIds: string[];
  /**
   * The slowest measured speaker latency among the audio-output devices, in ms.
   *
   * This is the pace the room runs at. Every device delays itself by
   * (referenceLatencyMs - its own latency) so all audio emerges at the same
   * moment and every cursor sits on the bar people are actually hearing.
   * Zero when nothing has been calibrated, which makes all compensation zero
   * and leaves behaviour exactly as it was before calibration.
   */
  referenceLatencyMs: number;
  participants: Participant[];
}

// ---------------------------------------------------------------------------
// Acoustic calibration
// ---------------------------------------------------------------------------

export type CalibrationStatus =
  /** Never run on this device. */
  | 'idle'
  /** No microphone, or not a secure context, so calibration cannot run. */
  | 'unsupported'
  /** The user declined microphone access. */
  | 'denied'
  | 'running'
  | 'ok'
  /** Ran, but the chirp could not be detected confidently. */
  | 'failed';

/**
 * One acoustic measurement.
 *
 * `roundTripMs` is what is actually measured: the time from scheduling the
 * chirp to detecting it in the microphone. That includes the output path, the
 * air, and the *input* path.
 *
 * `outputLatencyMs` is the share attributable to the output path alone, which
 * is the only part the sync correction cares about — see
 * frontend/src/lib/calibration.ts for how the two are related.
 */
export interface CalibrationResult {
  roundTripMs: number;
  outputLatencyMs: number;
  /** Detector confidence: correlation peak over background. Higher is better. */
  confidence: number;
  measuredAt: number;
}

/**
 * A cross-device measurement, made by a device listening to the audio-output
 * device's chirp. Reports how far behind the audio device's sound arrives here.
 */
export interface ListenerCalibration {
  offsetMs: number;
  confidence: number;
  measuredAt: number;
}

/** Detector confidence below this is treated as noise, not a measurement. */
export const MIN_CALIBRATION_CONFIDENCE = 5;

/**
 * Corrections outside this range are rejected. Real device latency tops out
 * around 300ms even over Bluetooth; anything larger means we locked onto the
 * wrong peak.
 */
export const MAX_CALIBRATION_OFFSET_MS = 500;

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
  /** Stop. The server decides the position so every device lands on the same one. */
  pause: () => void;
  seek: (payload: { positionMs: number }) => void;

  /**
   * Position report from the audio-output device, used to correct drift on
   * everyone else. Ignored from any device that is not the audio output.
   */
  positionReport: (payload: { positionMs: number; isPlaying: boolean }) => void;

  updateSettings: (payload: Partial<RoomSettings>) => void;

  /** Start producing sound on this device, alongside any others already doing so. */
  claimAudioOutput: () => void;
  /** Stop producing sound on this device. */
  releaseAudioOutput: () => void;

  /**
   * Clock synchronisation probe.
   *
   * The server echoes its own clock, letting the client estimate the offset
   * between the two clocks and the round-trip time. Transport interpolation
   * needs this: `transport.updatedAt` is stamped with the *server* clock, and
   * device clocks routinely differ from it by seconds.
   */
  timeSync: (
    payload: { clientSentAt: number },
    ack: (result: { clientSentAt: number; serverTime: number }) => void
  ) => void;

  /** Report this device's own measured output latency, or null to clear it. */
  calibration: (payload: { outputLatencyMs: number | null }) => void;

  /**
   * Audio-output device announcing that it is about to emit a calibration
   * chirp, so other devices know to listen and what to expect.
   */
  announceChirp: (payload: {
    chirpId: string;
    /** Server-clock time at which the chirp leaves the speaker. */
    emitAtServerTime: number;
    /** Chirp parameters, so listeners build an identical reference signal. */
    startHz: number;
    endHz: number;
    durationMs: number;
  }) => void;

  /** A listening device reporting what it heard. */
  chirpHeard: (payload: {
    chirpId: string;
    offsetMs: number;
    confidence: number;
  }) => void;

  /**
   * Ask the server to run a mutual calibration round: every participant emits a
   * chirp in turn while the others listen.
   */
  startCalibrationRound: () => void;
}

/** Events the server sends to clients. */
export interface ServerToClientEvents {
  /** Full snapshot. Sent on join and after disruptive changes. */
  state: (state: RoomState) => void;
  transport: (transport: TransportState) => void;
  settings: (settings: RoomSettings) => void;
  participants: (participants: Participant[]) => void;
  song: (payload: { song: ResolvedSong | null; history: ResolvedSong[] }) => void;
  audioOutput: (payload: {
    audioOutputDeviceIds: string[];
    referenceLatencyMs: number;
  }) => void;
  /** Transient, human-readable notice to surface in the UI. */
  notice: (payload: { level: 'info' | 'warn' | 'error'; message: string }) => void;

  /** Relayed chirp announcement; listeners arm their detector on this. */
  chirpScheduled: (payload: {
    chirpId: string;
    emitAtServerTime: number;
    startHz: number;
    endHz: number;
    durationMs: number;
    /** Device emitting the chirp, so it can ignore its own announcement. */
    fromDeviceId: string;
  }) => void;

  /** A listener's cross-device measurement, relayed for display. */
  chirpResult: (payload: {
    chirpId: string;
    deviceId: string;
    offsetMs: number;
    confidence: number;
  }) => void;

  /**
   * Whose turn it is to emit during a mutual calibration round.
   *
   * Devices take turns rather than chirping together: two chirps overlapping in
   * the air are indistinguishable to a matched filter looking for one waveform.
   */
  chirpTurn: (payload: {
    roundId: string;
    /** The device that should emit now. Everyone else listens. */
    deviceId: string;
    turnIndex: number;
    totalTurns: number;
  }) => void;

  /** A mutual round finished; carries the resulting per-device latencies. */
  calibrationRound: (payload: {
    roundId: string;
    latencies: { deviceId: string; outputLatencyMs: number | null }[];
    referenceLatencyMs: number;
  }) => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: RoomSettings = {
  metronome: 'off',
  transposeSemitones: 0,
  playbackSpeed: 1,
  loop: false,
  countInBars: 0,
  tracks: {},
  loopRange: null,
};

/** Transpose range offered in the UI, in semitones. */
export const MAX_TRANSPOSE_SEMITONES = 12;
/** Highest capo position offered. Beyond this there is not much neck left. */
export const MAX_CAPO_FRET = 12;

/** Resolve a track's settings, falling back to defaults. */
export function trackSettings(
  settings: RoomSettings,
  trackIndex: number
): TrackSettings {
  return settings.tracks[String(trackIndex)] ?? DEFAULT_TRACK_SETTINGS;
}

/**
 * Total semitone shift for a track: the room-wide transpose plus its own.
 *
 * Capo is deliberately not part of this. A capo changes which frets you press,
 * not the pitch that comes out, so folding it in here would transpose the audio
 * by the capo position and put the whole room in the wrong key.
 */
export function effectiveTranspose(
  settings: RoomSettings,
  trackIndex: number
): number {
  return settings.transposeSemitones + trackSettings(settings, trackIndex).transposeSemitones;
}

/**
 * Semitone shift to *draw* a track at, which is the sounding transpose minus
 * the capo.
 *
 * A capo at fret 2 means every note is fretted two lower than written while
 * sounding the same, so the tab has to read two lower. Pairing this with
 * {@link effectiveTranspose} for the audio is what separates the two: what you
 * read moves, what you hear does not.
 */
export function displayTranspose(
  settings: RoomSettings,
  trackIndex: number
): number {
  return effectiveTranspose(settings, trackIndex) - trackSettings(settings, trackIndex).capo;
}

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
