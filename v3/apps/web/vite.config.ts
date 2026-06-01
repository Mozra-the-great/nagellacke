import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

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
      '/api': 'http://localhost:3001',
      '/photos': 'http://localhost:3001',
    },
  },
});
