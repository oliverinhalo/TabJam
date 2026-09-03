import path from 'node:path';

/** Runtime configuration, all overridable by environment variables. */
export interface Config {
  port: number;
  libraryDir: string;
  maxUploadBytes: number;
  publicOrigin: string | null;
  /** Directory holding the built frontend, served as static files. */
  staticDir: string;
  isProduction: boolean;
}

export function loadConfig(): Config {
  const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? '25');

  return {
    port: Number(process.env.PORT ?? '8080'),
    libraryDir: path.resolve(process.env.LIBRARY_DIR ?? 'data/library'),
    maxUploadBytes: (Number.isFinite(maxUploadMb) ? maxUploadMb : 25) * 1024 * 1024,
    publicOrigin: process.env.PUBLIC_ORIGIN?.trim() || null,
    staticDir: path.resolve(process.env.STATIC_DIR ?? 'public'),
    isProduction: process.env.NODE_ENV === 'production',
  };
}
