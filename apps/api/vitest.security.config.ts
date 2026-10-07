import { defineConfig } from 'vitest/config';

// Cross-tenant security gate (E1-T06). Needs a running PostgreSQL (`pnpm infra:up`).
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.security.spec.ts'],
    testTimeout: 30_000,
  },
});
