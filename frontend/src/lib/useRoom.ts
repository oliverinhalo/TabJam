import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TRANSPORT,
  type ClientToServerEvents,
  type Participant,
  type ResolvedSong,
  type RoomSettings,
  type RoomState,
  type ServerToClientEvents,
  type TransportState,
} from '@tabjam/shared';
import { getDeviceId, getDeviceName, setDeviceName } from './device';
import { ClockSync, RESYNC_INTERVAL_MS, estimateClockOffset } from './clock';

type TabJamSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ChirpAnnouncement {
  chirpId: string;
  emitAtServerTime: number;
  startHz: number;
  endHz: number;
  durationMs: number;
  fromDeviceId: string;
}

export interface RoomApi {
  connected: boolean;
  joined: boolean;
  error: string | null;
  deviceId: string;
  name: string;
  song: ResolvedSong | null;
  history: ResolvedSong[];
  transport: TransportState;
  settings: RoomSettings;
  participants: Participant[];
  /** Every device currently producing sound. */
  audioOutputDeviceIds: string[];
  isAudioOutput: boolean;
  /** Slowest speaker among the audio sources; the pace the room runs at. */
  referenceLatencyMs: number;
  /** This device's own measured latency, as the room knows it. */
  ownLatencyMs: number | null;
  /**
   * How long this device must wait so it lines up with the slowest one.
   * Zero when nothing is calibrated, which is the pre-calibration behaviour.
   */
  compensationMs: number;
  notices: Notice[];
  dismissNotice: (id: number) => void;

  rename: (name: string) => void;
  loadSong: (song: ResolvedSong) => void;
  play: (positionMs?: number) => void;
  pause: (positionMs: number) => void;
  seek: (positionMs: number) => void;
  reportPosition: (positionMs: number, isPlaying: boolean) => void;
  updateSettings: (patch: Partial<RoomSettings>) => void;
  claimAudioOutput: () => void;
  releaseAudioOutput: () => void;

  /** Server/client clock estimate, shared with the calibration code. */
  clock: ClockSync;
  clockSynced: boolean;

  /** Publish this device's measured speaker latency to the room. */
  sendCalibration: (outputLatencyMs: number | null) => void;
  announceChirp: (payload: Omit<ChirpAnnouncement, 'fromDeviceId'>) => void;
  sendChirpHeard: (payload: {
    chirpId: string;
    offsetMs: number;
    confidence: number;
  }) => void;
  /** Subscribe to chirp announcements from whichever device is emitting. */
  onChirpScheduled: (handler: (announcement: ChirpAnnouncement) => void) => () => void;

  /** Ask the server to run a mutual round across every device in the room. */
  startCalibrationRound: () => void;
  /** Subscribe to "it is device X's turn to emit" during a mutual round. */
  onChirpTurn: (handler: (turn: ChirpTurn) => void) => () => void;
  /** Result of the most recently completed mutual round. */
  lastRound: CalibrationRoundResult | null;
}

export interface ChirpTurn {
  roundId: string;
  deviceId: string;
  turnIndex: number;
  totalTurns: number;
}

export interface CalibrationRoundResult {
  roundId: string;
  latencies: { deviceId: string; outputLatencyMs: number | null }[];
  referenceLatencyMs: number;
}

/**
 * Connects to a room and mirrors its server-authoritative state.
 *
 * All mutations go through the server rather than being applied locally first:
 * the round trip is a few milliseconds on a LAN, and it keeps one source of
 * truth instead of a local guess that has to be reconciled later.
 */
export function useRoom(roomId: string): RoomApi {
  const deviceId = useMemo(getDeviceId, []);
  const [name, setName] = useState(getDeviceName);

  const socketRef = useRef<TabJamSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [song, setSong] = useState<ResolvedSong | null>(null);
  const [history, setHistory] = useState<ResolvedSong[]>([]);
  const [transport, setTransport] = useState<TransportState>(DEFAULT_TRANSPORT);
  const [settings, setSettings] = useState<RoomSettings>(DEFAULT_SETTINGS);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [audioOutputDeviceIds, setAudioOutputDeviceIds] = useState<string[]>([]);
  const [referenceLatencyMs, setReferenceLatencyMs] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);

  // A song chosen while the socket is down would otherwise be emitted into
  // nothing: the upload succeeds over REST, the room never hears about it, and
  // the UI just keeps saying "No song loaded".
  const pendingSongRef = useRef<ResolvedSong | null>(null);

  const clockRef = useRef(new ClockSync());
  const [clockSynced, setClockSynced] = useState(false);
  // Chirp announcements are delivered to subscribers rather than through state:
  // they are one-shot events with a hard deadline, and a re-render would be a
  // needless detour on the way to arming the microphone.
  const chirpHandlers = useRef(new Set<(a: ChirpAnnouncement) => void>());
  const turnHandlers = useRef(new Set<(t: ChirpTurn) => void>());
  const [lastRound, setLastRound] = useState<CalibrationRoundResult | null>(null);

  const pushNotice = useCallback((level: Notice['level'], message: string) => {
    const notice: Notice = { id: Date.now() + Math.random(), level, message };
    setNotices((current) => [...current.slice(-3), notice]);
    // Notices are informational; clear them so they don't pile up on screen.
    setTimeout(() => {
      setNotices((current) => current.filter((n) => n.id !== notice.id));
    }, 6000);
  }, []);

  const applySnapshot = useCallback((state: RoomState) => {
    setSong(state.song);
    setHistory(state.history);
    setTransport(state.transport);
    setSettings(state.settings);
    setParticipants(state.participants);
    setAudioOutputDeviceIds(state.audioOutputDeviceIds);
    setReferenceLatencyMs(state.referenceLatencyMs);
  }, []);

  useEffect(() => {
    if (!roomId) return;

    /**
     * Transport order is left at the Socket.IO default (polling, then upgrade
     * to WebSocket) on purpose.
     *
     * Naming the transports with 'websocket' first looks like an optimisation
     * but is a trap: `tryAllTransports` defaults to false, so the client
     * attempts only the first entry and gives up rather than falling back. Any
     * network that blocks a raw WebSocket upgrade — most commonly a reverse
     * proxy not forwarding Upgrade headers — then fails to connect at all,
     * which surfaces as a permanently "offline" room. Polling connects
     * essentially everywhere and silently upgrades when it can.
     */
    const socket: TabJamSocket = io();
    socketRef.current = socket;

    const join = () => {
      socket.emit('join', { roomId, deviceId, name: getDeviceName() }, (result) => {
        if (result.ok) {
          applySnapshot(result.state);
          setJoined(true);
          setError(null);

          // Flush a song picked while the connection was down.
          const pending = pendingSongRef.current;
          if (pending) {
            pendingSongRef.current = null;
            socket.emit('loadSong', { song: pending });
          }
        } else {
          setError(result.error);
          setJoined(false);
        }
      });
    };

    let resyncTimer: ReturnType<typeof setInterval> | null = null;

    const syncClock = () => {
      void estimateClockOffset(socket).then((estimate) => {
        if (estimate) {
          clockRef.current.update(estimate);
          setClockSynced(true);
        }
      });
    };

    socket.on('connect', () => {
      setConnected(true);
      // Re-join on every connect, including reconnects after a wifi drop.
      join();
      // Clocks are re-estimated after a reconnect: the device may have slept,
      // and a stale offset is worse than none.
      syncClock();
      if (resyncTimer) clearInterval(resyncTimer);
      resyncTimer = setInterval(syncClock, RESYNC_INTERVAL_MS);
    });
    socket.on('disconnect', () => {
      setConnected(false);
      setJoined(false);
    });
    socket.on('connect_error', () => setConnected(false));

    socket.on('state', applySnapshot);
    socket.on('transport', setTransport);
    socket.on('settings', setSettings);
    socket.on('participants', setParticipants);
    socket.on('song', ({ song: next, history: nextHistory }) => {
      setSong(next);
      setHistory(nextHistory);
    });
    socket.on('audioOutput', ({ audioOutputDeviceIds: next, referenceLatencyMs: ref }) => {
      setAudioOutputDeviceIds(next);
      setReferenceLatencyMs(ref);
    });
    socket.on('notice', ({ level, message }) => pushNotice(level, message));
    socket.on('chirpScheduled', (announcement) => {
      for (const handler of chirpHandlers.current) handler(announcement);
    });
    socket.on('chirpTurn', (turn) => {
      for (const handler of turnHandlers.current) handler(turn);
    });
    socket.on('calibrationRound', (result) => {
      setLastRound(result);
      setReferenceLatencyMs(result.referenceLatencyMs);
    });

    return () => {
      if (resyncTimer) clearInterval(resyncTimer);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, deviceId, applySnapshot, pushNotice]);

  const emit = useCallback(
    <E extends keyof ClientToServerEvents>(
      event: E,
      ...args: Parameters<ClientToServerEvents[E]>
    ) => {
      socketRef.current?.emit(event, ...args);
    },
    []
  );

  const isAudioOutput = audioOutputDeviceIds.includes(deviceId);
  const ownLatencyMs =
    participants.find((p) => p.deviceId === deviceId)?.outputLatencyMs ?? null;
  // Waiting for the slowest device is what makes everything line up. A device
  // that has not measured itself waits zero rather than a guessed amount.
  const compensationMs =
    ownLatencyMs === null ? 0 : Math.max(0, referenceLatencyMs - ownLatencyMs);

  return {
    connected,
    joined,
    error,
    deviceId,
    name,
    song,
    history,
    transport,
    settings,
    participants,
    audioOutputDeviceIds,
    isAudioOutput,
    referenceLatencyMs,
    ownLatencyMs,
    compensationMs,
    notices,
    dismissNotice: (id) => setNotices((current) => current.filter((n) => n.id !== id)),

    rename: (next) => {
      setName(next);
      setDeviceName(next);
      emit('rename', { name: next });
    },
    loadSong: (next) => {
      const socket = socketRef.current;
      if (!socket?.connected) {
        pendingSongRef.current = next;
        pushNotice('warn', 'Offline — the song will load once you reconnect.');
        return;
      }
      socket.emit('loadSong', { song: next }, (result) => {
        if (!result?.ok) {
          pushNotice('error', result?.error ?? 'Could not load that song.');
        }
      });
    },
    play: (positionMs) => emit('play', { positionMs }),
    pause: (positionMs) => emit('pause', { positionMs }),
    seek: (positionMs) => emit('seek', { positionMs }),
    reportPosition: (positionMs, isPlaying) =>
      emit('positionReport', { positionMs, isPlaying }),
    updateSettings: (patch) => emit('updateSettings', patch),
    claimAudioOutput: () => emit('claimAudioOutput'),
    releaseAudioOutput: () => emit('releaseAudioOutput'),

    clock: clockRef.current,
    clockSynced,

    sendCalibration: (outputLatencyMs) => emit('calibration', { outputLatencyMs }),
    announceChirp: (payload) => emit('announceChirp', payload),
    sendChirpHeard: (payload) => emit('chirpHeard', payload),
    onChirpScheduled: (handler) => {
      chirpHandlers.current.add(handler);
      return () => chirpHandlers.current.delete(handler);
    },

    startCalibrationRound: () => emit('startCalibrationRound'),
    onChirpTurn: (handler) => {
      turnHandlers.current.add(handler);
      return () => turnHandlers.current.delete(handler);
    },
    lastRound,
  };
}
