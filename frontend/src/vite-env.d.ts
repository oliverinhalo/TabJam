/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the soundfont URL, e.g. to self-host it for an offline install. */
  readonly VITE_SOUNDFONT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
