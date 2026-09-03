import {
  DEFAULT_SETTINGS,
  DEFAULT_TRANSPORT,
  DEFAULT_TRACK_SETTINGS,
  MAX_CALIBRATION_OFFSET_MS,
  MAX_CAPO_FRET,
  MAX_TRANSPOSE_SEMITONES,
  type Participant,
  type ResolvedSong,
  type RoomSettings,
  type RoomState,
  type TransportState,
} from '@tabjam/shared';

/**
 * In-memory room state for a single Node process.
 *
 * That is deliberate for the MVP: a handful of people on one self-hosted box.
 * Everything here is plain data with no I/O, so swapping in SQLite later means
 * writing this state out on change and reading it back at boot — see the
 * persistence note in the README.
 */

const MAX_HISTORY = 12;
/** Rooms with nobody connected are dropped after this long. */
const EMPTY_ROOM_TTL_MS = 6 * 60 * 60 * 1000;

interface Room {
  state: RoomState;
  /** Socket ids per device, so multiple tabs on one device behave sanely. */
  sockets: Map<string, Set<string>>;
  emptiedAt: number | null;
}

export class RoomStore {
  private readonly rooms = new Map<string, Room>();

  constructor() {
    setInterval(() => this.sweep(), 15 * 60 * 1000).unref();
  }

  /** Create a room, or return the existing one for this id. */
  ensure(roomId: string): RoomState {
    const existing = this.rooms.get(roomId);
    if (existing) {
      existing.emptiedAt = null;
      return existing.state;
    }

    const state: RoomState = {
      roomId,
      song: null,
      history: [],
      transport: { ...DEFAULT_TRANSPORT, updatedAt: Date.now() },
      settings: { ...DEFAULT_SETTINGS },
      audioOutputDeviceIds: [],
      referenceLatencyMs: 0,
      participants: [],
    };
    this.rooms.set(roomId, { state, sockets: new Map(), emptiedAt: null });
    return state;
  }

  get(roomId: string): RoomState | null {
    return this.rooms.get(roomId)?.state ?? null;
  }

  has(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  /**
   * Register a connected device. Returns the room state.
   * The first device to join an unclaimed room becomes the audio output.
   */
  join(
    roomId: string,
    deviceId: string,
    name: string,
    socketId: string
  ): RoomState {
    const state = this.ensure(roomId);
    const room = this.rooms.get(roomId)!;

    const sockets = room.sockets.get(deviceId) ?? new Set<string>();
    sockets.add(socketId);
    room.sockets.set(deviceId, sockets);
    room.emptiedAt = null;

    const existing = state.participants.find((p) => p.deviceId === deviceId);
    if (existing) {
      existing.online = true;
      if (name) existing.name = name;
    } else {
      state.participants.push({
        deviceId,
        name: name || 'Player',
        connectedAt: Date.now(),
        online: true,
        outputLatencyMs: null,
      });
    }

    if (state.audioOutputDeviceIds.length === 0) {
      state.audioOutputDeviceIds = [deviceId];
    }
    this.recomputeReference(state);

    return state;
  }

  /**
   * Drop one socket. Returns the affected room state, or null if unknown.
   * A device only goes offline once its last socket closes.
   */
  leave(roomId: string, deviceId: string, socketId: string): RoomState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const sockets = room.sockets.get(deviceId);
    sockets?.delete(socketId);

    if (!sockets || sockets.size === 0) {
      room.sockets.delete(deviceId);
      const participant = room.state.participants.find((p) => p.deviceId === deviceId);
      if (participant) participant.online = false;

      // A departing device stops being an audio source.
      if (room.state.audioOutputDeviceIds.includes(deviceId)) {
        room.state.audioOutputDeviceIds = room.state.audioOutputDeviceIds.filter(
          (id) => id !== deviceId
        );

        // Keep the room audible by promoting someone still present.
        if (room.state.audioOutputDeviceIds.length === 0) {
          const next = room.state.participants.find((p) => p.online);
          if (next) {
            room.state.audioOutputDeviceIds = [next.deviceId];
          } else {
            // Nobody can make sound, so stop rather than let the transport drift.
            room.state.transport = {
              ...room.state.transport,
              isPlaying: false,
              updatedAt: Date.now(),
            };
          }
        }
        this.recomputeReference(room.state);
      }
    }

    if (room.sockets.size === 0) {
      room.emptiedAt = Date.now();
      // Drop participants who never come back; keep the song and settings.
      room.state.participants = room.state.participants.filter((p) => p.online);
    }

    return room.state;
  }

  rename(roomId: string, deviceId: string, name: string): RoomState | null {
    const state = this.get(roomId);
    if (!state) return null;
    const participant = state.participants.find((p) => p.deviceId === deviceId);
    if (participant && name.trim()) participant.name = name.trim().slice(0, 40);
    return state;
  }

  setSong(roomId: string, song: ResolvedSong): RoomState | null {
    const state = this.get(roomId);
    if (!state) return null;

    if (state.song && state.song.id !== song.id) {
      state.history = [state.song, ...state.history.filter((s) => s.id !== state.song!.id)].slice(
        0,
        MAX_HISTORY
      );
    }
    state.song = song;
    // A new song invalidates the old position.
    state.transport = {
      ...state.transport,
      isPlaying: false,
      positionMs: 0,
      updatedAt: Date.now(),
    };
    return state;
  }

  setTransport(roomId: string, patch: Partial<TransportState>): TransportState | null {
    const state = this.get(roomId);
    if (!state) return null;
    state.transport = {
      ...state.transport,
      ...patch,
      updatedAt: Date.now(),
    };
    return state.transport;
  }

  /**
   * Where the room is right now, extrapolated from the last known position.
   *
   * Used when stopping, so the pause lands on one agreed position instead of
   * whichever client happened to press the button. Clients disagree: an audio
   * device reports where the sound has reached, a screen-only device reports
   * its own interpolated cursor, and taking either as truth left everyone
   * parked a few hundred milliseconds apart.
   */
  currentPosition(roomId: string): number {
    const state = this.get(roomId);
    if (!state) return 0;

    const { transport } = state;
    if (!transport.isPlaying) return transport.positionMs;
    return transport.positionMs + Math.max(0, Date.now() - transport.updatedAt);
  }

  updateSettings(roomId: string, patch: Partial<RoomSettings>): RoomSettings | null {
    const state = this.get(roomId);
    if (!state) return null;
    state.settings = { ...state.settings, ...sanitizeSettings(patch) };
    return state.settings;
  }

  /**
   * Claim the audio-output role.
   *
   * Returns the device that ends up holding it. Claiming is last-write-wins on
   * a single-threaded server, which is all the guard two simultaneous claims
   * need: the second claim simply supersedes the first and everyone is told the
   * same answer via the broadcast that follows.
   */
  /**
   * Add a device to the set producing sound.
   *
   * Several devices may produce sound at once. Keeping them in step is what the
   * latency compensation is for: each delays itself to the slowest, so their
   * outputs emerge together rather than as a flam.
   */
  claimAudioOutput(roomId: string, deviceId: string): string[] | null {
    const state = this.get(roomId);
    if (!state) return null;

    const known = state.participants.some((p) => p.deviceId === deviceId && p.online);
    if (known && !state.audioOutputDeviceIds.includes(deviceId)) {
      state.audioOutputDeviceIds = [...state.audioOutputDeviceIds, deviceId];
      this.recomputeReference(state);
    }
    return state.audioOutputDeviceIds;
  }

  releaseAudioOutput(roomId: string, deviceId: string): string[] | null {
    const state = this.get(roomId);
    if (!state) return null;
    if (!state.audioOutputDeviceIds.includes(deviceId)) {
      return state.audioOutputDeviceIds;
    }

    state.audioOutputDeviceIds = state.audioOutputDeviceIds.filter(
      (id) => id !== deviceId
    );
    // Leaving a room with nothing making sound would let the transport run on
    // silently, so stop it instead.
    if (state.audioOutputDeviceIds.length === 0) {
      state.transport = { ...state.transport, isPlaying: false, updatedAt: Date.now() };
    }
    this.recomputeReference(state);
    return state.audioOutputDeviceIds;
  }

  /**
   * Record a device's measured speaker latency.
   *
   * Values are clamped and sanity-checked here as well as on the client: a
   * wild number would drag the whole room's cursor off the music.
   */
  setCalibration(
    roomId: string,
    deviceId: string,
    outputLatencyMs: number | null
  ): RoomState | null {
    const state = this.get(roomId);
    if (!state) return null;

    const participant = state.participants.find((p) => p.deviceId === deviceId);
    if (!participant) return state;

    if (outputLatencyMs === null) {
      participant.outputLatencyMs = null;
    } else if (Number.isFinite(outputLatencyMs)) {
      participant.outputLatencyMs = clamp(
        outputLatencyMs,
        0,
        MAX_CALIBRATION_OFFSET_MS
      );
    }
    // A fresh measurement can change which device is the slowest.
    this.recomputeReference(state);
    return state;
  }

  isAudioOutput(roomId: string, deviceId: string): boolean {
    return this.get(roomId)?.audioOutputDeviceIds.includes(deviceId) ?? false;
  }

  /**
   * Recompute the room's reference latency: the slowest speaker among the
   * devices actually producing sound.
   *
   * Only audio sources count. A silent phone's Bluetooth headphones say nothing
   * about when the room hears a note, and letting one set the pace would delay
   * everybody for no reason.
   *
   * Uncalibrated devices contribute nothing rather than a guess, so a room
   * where nobody has calibrated keeps a reference of 0 and behaves exactly as
   * it did before any of this existed.
   */
  private recomputeReference(state: RoomState): void {
    const latencies = state.audioOutputDeviceIds
      .map((id) => state.participants.find((p) => p.deviceId === id)?.outputLatencyMs)
      .filter((value): value is number => typeof value === 'number');

    state.referenceLatencyMs = latencies.length > 0 ? Math.max(...latencies) : 0;
  }

  /** Public wrapper, for callers that changed a latency out of band. */
  refreshReference(roomId: string): RoomState | null {
    const state = this.get(roomId);
    if (state) this.recomputeReference(state);
    return state;
  }

  stats(): { rooms: number; participants: number } {
    let participants = 0;
    for (const room of this.rooms.values()) {
      participants += room.state.participants.filter((p) => p.online).length;
    }
    return { rooms: this.rooms.size, participants };
  }

  private sweep(): void {
    const cutoff = Date.now() - EMPTY_ROOM_TTL_MS;
    for (const [roomId, room] of this.rooms) {
      if (room.emptiedAt !== null && room.emptiedAt < cutoff) {
        this.rooms.delete(roomId);
      }
    }
  }
}

/** Clamp incoming settings so a bad client cannot put the room in a weird state. */
function sanitizeSettings(patch: Partial<RoomSettings>): Partial<RoomSettings> {
  const clean: Partial<RoomSettings> = {};

  if (patch.metronome !== undefined && ['off', 'click', 'spoken'].includes(patch.metronome)) {
    clean.metronome = patch.metronome;
  }
  if (patch.transposeSemitones !== undefined) {
    clean.transposeSemitones = Math.round(
      clamp(patch.transposeSemitones, -MAX_TRANSPOSE_SEMITONES, MAX_TRANSPOSE_SEMITONES)
    );
  }
  if (patch.playbackSpeed !== undefined) {
    clean.playbackSpeed = clamp(patch.playbackSpeed, 0.25, 2);
  }
  if (patch.loop !== undefined) {
    clean.loop = Boolean(patch.loop);
  }
  if (patch.countInBars !== undefined) {
    clean.countInBars = Math.round(clamp(patch.countInBars, 0, 4));
  }
  if (patch.loopRange !== undefined) {
    clean.loopRange = sanitizeLoopRange(patch.loopRange);
  }
  if (patch.tracks !== undefined) {
    clean.tracks = sanitizeTracks(patch.tracks);
  }
  return clean;
}

/** A loop needs a sane, ordered, 1-based bar range or none at all. */
function sanitizeLoopRange(range: RoomSettings['loopRange']): RoomSettings['loopRange'] {
  if (!range || typeof range !== 'object') return null;

  const start = Math.round(Number(range.startBar));
  const end = Math.round(Number(range.endBar));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 1 || end < 1) return null;

  // Accept a reversed range rather than rejecting it; dragging a selection
  // backwards is a normal thing to do.
  return { startBar: Math.min(start, end), endBar: Math.max(start, end) };
}

/**
 * Clamp per-track settings.
 *
 * The whole map is replaced rather than merged: the client always sends the
 * complete set it wants, so a merge would make removing a track's override
 * impossible.
 */
function sanitizeTracks(
  tracks: RoomSettings['tracks']
): RoomSettings['tracks'] {
  if (!tracks || typeof tracks !== 'object') return {};

  const clean: RoomSettings['tracks'] = {};
  for (const [key, value] of Object.entries(tracks)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index > 512) continue;
    if (!value || typeof value !== 'object') continue;

    clean[String(index)] = {
      transposeSemitones: Math.round(
        clamp(
          Number(value.transposeSemitones ?? 0),
          -MAX_TRANSPOSE_SEMITONES,
          MAX_TRANSPOSE_SEMITONES
        )
      ),
      capo: Math.round(clamp(Number(value.capo ?? 0), 0, MAX_CAPO_FRET)),
      muted: Boolean(value.muted),
      solo: Boolean(value.solo),
      volume: clamp(Number(value.volume ?? DEFAULT_TRACK_SETTINGS.volume), 0, 1),
    };
  }
  return clean;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
