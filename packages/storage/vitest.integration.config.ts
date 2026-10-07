import { defineConfig } from 'vitest/config';

// Integration tests need the local S3-compatible storage (`pnpm infra:up`).
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.integration.spec.ts'],
    testTimeout: 30_000,
  },
});
