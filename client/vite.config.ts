import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      shared: path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 3000,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
    proxy: {
      '/ws-signaling': { target: 'ws://localhost:4000', ws: true },
      '/ws-game': { target: 'ws://localhost:4001', ws: true },
    },
  },
});
