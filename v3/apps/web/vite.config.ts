import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Same PORT the server reads (default 3000), so the dev proxy follows the server.
const apiTarget = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@nagellacke/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@nagellacke/sync': path.resolve(__dirname, '../../packages/sync/src/index.ts'),
    },
  },
  server: {
    proxy: {
      '/api': apiTarget,
      '/photos': apiTarget,
    },
  },
});
