import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { customAlphabet } from 'nanoid';
import type { Config } from '../config.js';
import type { RoomStore } from '../rooms/RoomStore.js';
import {
  ScoreSourceError,
  type SourceRegistry,
  lookupSongsterr,
} from '../sources/index.js';

/** Room ids people have to read aloud and type on a phone: short, unambiguous. */
const makeRoomId = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 8);

export function createRoutes(
  config: Config,
  rooms: RoomStore,
  sources: SourceRegistry
): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes },
  });

  // --- Health ------------------------------------------------------------

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), ...rooms.stats() });
  });

  // --- Rooms -------------------------------------------------------------

  router.post('/rooms', (req: Request, res: Response) => {
    const roomId = makeRoomId();
    rooms.ensure(roomId);
    res.status(201).json({ roomId, url: buildRoomUrl(req, config, roomId) });
  });

  router.get('/rooms/:roomId', (req: Request, res: Response) => {
    const state = rooms.get(req.params.roomId);
    if (!state) {
      res.status(404).json({ error: 'No such room.' });
      return;
    }
    res.json(state);
  });

  // --- Library -----------------------------------------------------------

  router.get('/library', asyncHandler(async (_req, res) => {
    res.json({ files: await sources.library.list() });
  }));

  router.post(
    '/library',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded.' });
        return;
      }
      const song = await sources.library.save(req.file.originalname, req.file.buffer);
      res.status(201).json({ song });
    })
  );

  router.delete('/library/:id', asyncHandler(async (req, res) => {
    await sources.library.delete(req.params.id);
    res.status(204).end();
  }));

  // --- Songs -------------------------------------------------------------

  /** Resolve a reference (library id or direct file URL) to a loadable song. */
  router.post('/songs/resolve', asyncHandler(async (req, res) => {
    const reference = String(req.body?.reference ?? '');
    res.json({ song: await sources.resolve(reference) });
  }));

  /**
   * Songsterr metadata lookup.
   *
   * Returns title, artist and the track list only. Songsterr does not publicly
   * serve the notation itself, so this endpoint is for identifying a song and
   * checking a Guitar Pro file against its real track list — not for loading
   * playable notation. See sources/songsterr.ts.
   */
  router.get('/songsterr', asyncHandler(async (req, res) => {
    const reference = String(req.query.q ?? '');
    if (!reference.trim()) {
      res.status(400).json({ error: 'Pass ?q= a Songsterr URL or song id.' });
      return;
    }
    const meta = await lookupSongsterr(reference);
    res.json({
      meta,
      notice:
        'Songsterr supplies metadata only. Load a Guitar Pro file from your library to get playable notation.',
    });
  }));

  // --- Tab files ---------------------------------------------------------

  /**
   * Serve Guitar Pro bytes to the browser. Everything the frontend loads comes
   * through here, so alphaTab never makes a cross-origin request.
   */
  router.get('/tab/:id/file', asyncHandler(async (req, res) => {
    const { data, filename } = await sources.fetchFile(req.params.id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    // Files are immutable for a given id, so let the browser keep them.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(data);
  }));

  return router;
}

function buildRoomUrl(req: Request, config: Config, roomId: string): string {
  const origin =
    config.publicOrigin ??
    `${req.protocol}://${req.get('host') ?? `localhost:${config.port}`}`;
  return `${origin.replace(/\/$/, '')}/session/${roomId}`;
}

/** Wrap an async handler so rejections reach the error middleware. */
function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: (err?: unknown) => void) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/** Maps ScoreSourceError to its status; anything else is a 500. */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: (err?: unknown) => void
): void {
  if (err instanceof ScoreSourceError) {
    res.status(err.status).json({ error: err.message, hint: err.hint });
    return;
  }
  if (isMulterLimitError(err)) {
    res.status(413).json({ error: 'That file is too large.' });
    return;
  }
  console.error('[tabjam] unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
}

function isMulterLimitError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'LIMIT_FILE_SIZE'
  );
}
