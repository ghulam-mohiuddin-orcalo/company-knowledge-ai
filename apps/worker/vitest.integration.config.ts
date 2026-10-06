import { defineConfig } from 'vitest/config';

// Integration tests need the local stack (`pnpm infra:up`).
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.integration.spec.ts'],
    testTimeout: 60_000,
  },
});
