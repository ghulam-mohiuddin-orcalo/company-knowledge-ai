import { defineConfig } from 'vitest/config';

// Unit tests (no database needed).
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.integration.spec.ts', 'node_modules', 'dist'],
  },
});
