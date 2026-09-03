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

type TabJamSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
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
  audioOutputDeviceId: string | null;
  isAudioOutput: boolean;
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
  const [audioOutputDeviceId, setAudioOutputDeviceId] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);

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
    setAudioOutputDeviceId(state.audioOutputDeviceId);
  }, []);

  useEffect(() => {
    if (!roomId) return;

    const socket: TabJamSocket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    const join = () => {
      socket.emit('join', { roomId, deviceId, name: getDeviceName() }, (result) => {
        if (result.ok) {
          applySnapshot(result.state);
          setJoined(true);
          setError(null);
        } else {
          setError(result.error);
          setJoined(false);
        }
      });
    };

    socket.on('connect', () => {
      setConnected(true);
      // Re-join on every connect, including reconnects after a wifi drop.
      join();
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
    socket.on('audioOutput', ({ audioOutputDeviceId: next }) => {
      setAudioOutputDeviceId(next);
    });
    socket.on('notice', ({ level, message }) => pushNotice(level, message));

    return () => {
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

  const isAudioOutput = audioOutputDeviceId === deviceId;

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
    audioOutputDeviceId,
    isAudioOutput,
    notices,
    dismissNotice: (id) => setNotices((current) => current.filter((n) => n.id !== id)),

    rename: (next) => {
      setName(next);
      setDeviceName(next);
      emit('rename', { name: next });
    },
    loadSong: (next) => emit('loadSong', { song: next }),
    play: (positionMs) => emit('play', { positionMs }),
    pause: (positionMs) => emit('pause', { positionMs }),
    seek: (positionMs) => emit('seek', { positionMs }),
    reportPosition: (positionMs, isPlaying) =>
      emit('positionReport', { positionMs, isPlaying }),
    updateSettings: (patch) => emit('updateSettings', patch),
    claimAudioOutput: () => emit('claimAudioOutput'),
    releaseAudioOutput: () => emit('releaseAudioOutput'),
  };
}
