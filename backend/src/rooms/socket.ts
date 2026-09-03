import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  RoomSettings,
  ServerToClientEvents,
} from '@tabjam/shared';
import type { RoomStore } from './RoomStore.js';

type TabJamServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TabJamSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Per-socket identity, set at join time. */
interface SocketContext {
  roomId: string;
  deviceId: string;
}

const contexts = new WeakMap<TabJamSocket, SocketContext>();

export function registerSocketHandlers(io: TabJamServer, rooms: RoomStore): void {
  io.on('connection', (socket) => {
    socket.on('join', (payload, ack) => {
      const roomId = String(payload?.roomId ?? '').trim();
      const deviceId = String(payload?.deviceId ?? '').trim();

      if (!roomId || !deviceId) {
        ack?.({ ok: false, error: 'roomId and deviceId are required.' });
        return;
      }

      const name = String(payload?.name ?? '').trim().slice(0, 40) || 'Player';
      const state = rooms.join(roomId, deviceId, name, socket.id);

      contexts.set(socket, { roomId, deviceId });
      void socket.join(roomId);

      ack?.({ ok: true, state });
      // Everyone else needs to know about the new arrival and any audio
      // reassignment that came with it.
      socket.to(roomId).emit('participants', state.participants);
      io.to(roomId).emit('audioOutput', {
        audioOutputDeviceId: state.audioOutputDeviceId,
      });
    });

    socket.on('rename', (payload) => {
      const ctx = contexts.get(socket);
      if (!ctx) return;
      const state = rooms.rename(ctx.roomId, ctx.deviceId, String(payload?.name ?? ''));
      if (state) io.to(ctx.roomId).emit('participants', state.participants);
    });

    socket.on('loadSong', (payload, ack) => {
      const ctx = contexts.get(socket);
      if (!ctx) {
        ack?.({ ok: false, error: 'Not joined to a room.' });
        return;
      }
      if (!payload?.song?.id || !payload.song.fileUrl) {
        ack?.({ ok: false, error: 'Invalid song payload.' });
        return;
      }

      const state = rooms.setSong(ctx.roomId, payload.song);
      if (!state) {
        ack?.({ ok: false, error: 'Room not found.' });
        return;
      }

      ack?.({ ok: true });
      io.to(ctx.roomId).emit('song', { song: state.song, history: state.history });
      io.to(ctx.roomId).emit('transport', state.transport);
    });

    // --- Transport -------------------------------------------------------
    // Open to any participant on purpose: this is a jam tool, not a classroom.

    socket.on('play', (payload) => {
      const ctx = contexts.get(socket);
      if (!ctx) return;
      const positionMs = toPosition(payload?.positionMs);
      const transport = rooms.setTransport(ctx.roomId, {
        isPlaying: true,
        ...(positionMs !== null ? { positionMs } : {}),
      });
      if (transport) io.to(ctx.roomId).emit('transport', transport);
    });

    socket.on('pause', (payload) => {
      const ctx = contexts.get(socket);
      if (!ctx) return;
      const positionMs = toPosition(payload?.positionMs);
      const transport = rooms.setTransport(ctx.roomId, {
        isPlaying: false,
        ...(positionMs !== null ? { positionMs } : {}),
      });
      if (transport) io.to(ctx.roomId).emit('transport', transport);
    });

    socket.on('seek', (payload) => {
      const ctx = contexts.get(socket);
      if (!ctx) return;
      const positionMs = toPosition(payload?.positionMs);
      if (positionMs === null) return;
      const transport = rooms.setTransport(ctx.roomId, { positionMs });
      if (transport) io.to(ctx.roomId).emit('transport', transport);
    });

    /**
     * Drift correction. Only the audio-output device's clock counts — it is the
     * one actually rendering sound, so its position is ground truth. Reports
     * from anyone else are dropped rather than fought over.
     */
    socket.on('positionReport', (payload) => {
      const ctx = contexts.get(socket);
      if (!ctx) return;
      if (!rooms.isAudioOutput(ctx.roomId, ctx.deviceId)) return;

      const positionMs = toPosition(payload?.positionMs);
      if (positionMs === null) return;

      const transport = rooms.setTransport(ctx.roomId, {
        positionMs,
        isPlaying: Boolean(payload?.isPlaying),
      });
      // Broadcast to everyone *except* the reporter; it already knows.
      if (transport) socket.to(ctx.roomId).emit('transport', transport);
    });

    // --- Settings --------------------------------------------------------

    socket.on('updateSettings', (payload) => {
      const ctx = contexts.get(socket);
      if (!ctx || !payload || typeof payload !== 'object') return;
      const settings = rooms.updateSettings(ctx.roomId, payload as Partial<RoomSettings>);
      if (settings) io.to(ctx.roomId).emit('settings', settings);
    });

    // --- Audio output ----------------------------------------------------

    socket.on('claimAudioOutput', () => {
      const ctx = contexts.get(socket);
      if (!ctx) return;
      const holder = rooms.claimAudioOutput(ctx.roomId, ctx.deviceId);
      io.to(ctx.roomId).emit('audioOutput', { audioOutputDeviceId: holder });

      const state = rooms.get(ctx.roomId);
      const name =
        state?.participants.find((p) => p.deviceId === holder)?.name ?? 'Someone';
      io.to(ctx.roomId).emit('notice', {
        level: 'info',
        message: `${name} is now playing audio.`,
      });
    });

    socket.on('releaseAudioOutput', () => {
      const ctx = contexts.get(socket);
      if (!ctx) return;
      const holder = rooms.releaseAudioOutput(ctx.roomId, ctx.deviceId);
      io.to(ctx.roomId).emit('audioOutput', { audioOutputDeviceId: holder });
      if (holder === null) {
        io.to(ctx.roomId).emit('notice', {
          level: 'warn',
          message: 'No device is producing audio. Claim it to hear playback.',
        });
      }
    });

    socket.on('disconnect', () => {
      const ctx = contexts.get(socket);
      if (!ctx) return;
      const state = rooms.leave(ctx.roomId, ctx.deviceId, socket.id);
      contexts.delete(socket);
      if (!state) return;

      io.to(ctx.roomId).emit('participants', state.participants);
      io.to(ctx.roomId).emit('audioOutput', {
        audioOutputDeviceId: state.audioOutputDeviceId,
      });
      if (!state.transport.isPlaying) {
        io.to(ctx.roomId).emit('transport', state.transport);
      }
    });
  });
}

/** Accept a finite, non-negative position; reject anything else. */
function toPosition(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}
