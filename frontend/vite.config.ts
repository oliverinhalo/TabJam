import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8080';

export default defineConfig({
  // alphaTab's plugin copies its worker, soundfont and font assets into the
  // build and wires up the worklet/worker imports.
  plugins: [react(), alphaTab({ assetOutputDir: 'dist' })],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/socket.io': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
