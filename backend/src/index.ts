import { createServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@tabjam/shared';
import { loadConfig } from './config.js';
import { RoomStore } from './rooms/RoomStore.js';
import { registerSocketHandlers } from './rooms/socket.js';
import { createRoutes, errorMiddleware } from './http/routes.js';
import { LibrarySource, SourceRegistry, UrlSource } from './sources/index.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const library = new LibrarySource(config.libraryDir);
  await library.init();
  const sources = new SourceRegistry(library, new UrlSource(config.maxUploadBytes));
  const rooms = new RoomStore();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createRoutes(config, rooms, sources));

  // Serve the built frontend when it exists (production image).
  app.use(express.static(config.staticDir, { index: false }));

  // Client-side routing: anything not under /api falls through to the SPA.
  app.get(/^(?!\/api\/).*/, (_req, res, next) => {
    res.sendFile(path.join(config.staticDir, 'index.html'), (err) => {
      if (err) next();
    });
  });

  app.use(errorMiddleware);

  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    // Same-origin in the container; permissive in dev where Vite is on another port.
    cors: config.isProduction ? {} : { origin: true },
  });
  registerSocketHandlers(io, rooms);

  httpServer.listen(config.port, () => {
    console.log(`[tabjam] listening on :${config.port}`);
    console.log(`[tabjam] library directory: ${config.libraryDir}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[tabjam] ${signal} received, shutting down`);
    io.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[tabjam] failed to start:', err);
  process.exit(1);
});
