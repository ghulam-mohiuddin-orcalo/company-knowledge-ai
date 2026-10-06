import { defineConfig } from 'vitest/config';

// Integration tests need a running, migrated PostgreSQL (`pnpm infra:up`).
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.integration.spec.ts'],
    testTimeout: 30_000,
  },
});
