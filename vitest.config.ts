import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    // better-sqlite3 is a native addon and it does not survive a worker thread
    // being torn down, so every file gets a forked process of its own
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
});
