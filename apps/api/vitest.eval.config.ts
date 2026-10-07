import { defineConfig } from 'vitest/config';

// RAG evaluation (E4-T04, E5-T06). Needs PostgreSQL (`pnpm infra:up`).
// Offline by default; EVAL_PROVIDERS=configured uses the real configured providers.
export default defineConfig({
  test: {
    globals: true,
    include: ['src/evaluation/**/*.eval.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
