import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8080';

export default defineConfig({
  // The alphaTab plugin wires up its worker/worklet imports. Its asset copying
  // is disabled: it races Vite emptying outDir, so the music font landed in the
  // build only sometimes. scripts/copy-fonts.mjs puts it in public/ instead,
  // which Vite copies deterministically. See that script for the full story.
  plugins: [react(), alphaTab({ assetOutputDir: false })],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/socket.io': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
