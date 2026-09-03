import {
  DEFAULT_SETTINGS,
  DEFAULT_TRANSPORT,
  MAX_CALIBRATION_OFFSET_MS,
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
      audioOutputDeviceId: null,
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

    if (state.audioOutputDeviceId === null) {
      state.audioOutputDeviceId = deviceId;
    }

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

      // Hand the audio role to someone still present, if anyone is.
      if (room.state.audioOutputDeviceId === deviceId) {
        const next = room.state.participants.find((p) => p.online);
        room.state.audioOutputDeviceId = next?.deviceId ?? null;
        // Nobody can make sound, so stop the transport rather than let it drift.
        if (!next) {
          room.state.transport = {
            ...room.state.transport,
            isPlaying: false,
            updatedAt: Date.now(),
          };
        }
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
  claimAudioOutput(roomId: string, deviceId: string): string | null {
    const state = this.get(roomId);
    if (!state) return null;
    const known = state.participants.some((p) => p.deviceId === deviceId && p.online);
    if (!known) return state.audioOutputDeviceId;
    state.audioOutputDeviceId = deviceId;
    return deviceId;
  }

  releaseAudioOutput(roomId: string, deviceId: string): string | null {
    const state = this.get(roomId);
    if (!state) return null;
    if (state.audioOutputDeviceId !== deviceId) return state.audioOutputDeviceId;

    const next = state.participants.find((p) => p.online && p.deviceId !== deviceId);
    state.audioOutputDeviceId = next?.deviceId ?? null;
    if (!next) {
      state.transport = { ...state.transport, isPlaying: false, updatedAt: Date.now() };
    }
    return state.audioOutputDeviceId;
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
    return state;
  }

  isAudioOutput(roomId: string, deviceId: string): boolean {
    return this.get(roomId)?.audioOutputDeviceId === deviceId;
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

  if (patch.masterVolume !== undefined) {
    clean.masterVolume = clamp(patch.masterVolume, 0, 1);
  }
  if (patch.metronome !== undefined && ['off', 'click', 'spoken'].includes(patch.metronome)) {
    clean.metronome = patch.metronome;
  }
  if (patch.transposeSemitones !== undefined) {
    clean.transposeSemitones = Math.round(clamp(patch.transposeSemitones, -12, 12));
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
  return clean;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
