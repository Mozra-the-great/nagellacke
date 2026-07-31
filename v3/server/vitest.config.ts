import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only unit tests; nothing here should reach the network.
    include: ['src/**/*.test.ts'],
  },
});
