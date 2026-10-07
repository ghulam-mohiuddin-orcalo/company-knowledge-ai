import { defineConfig, devices } from '@playwright/test';
import { AI_PORT, API_URL, BACKEND_ENV, WEB_ENV, WEB_URL } from './support/env';

const root = new URL('../../', import.meta.url).pathname;
const env = (vars: Record<string, string>) =>
  ({ ...process.env, ...vars }) as Record<string, string>;

/**
 * Product E2E (E7/E8). Requires the local stack with the dev IdP:
 * `pnpm infra:up && pnpm infra:auth`, and built packages/apps (`pnpm build`).
 * Starts the AI stand-in, API, worker and web app (built with E2E settings).
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node support/fake-ai-server.mjs',
      url: `http://127.0.0.1:${AI_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      command: 'node dist/main.js',
      cwd: `${root}apps/api`,
      env: env(BACKEND_ENV),
      url: `${API_URL}/health`,
      reuseExistingServer: false,
    },
    {
      command: 'node dist/main.js',
      cwd: `${root}apps/worker`,
      env: env(BACKEND_ENV),
      // The worker has no HTTP port: wait for its startup log line.
      wait: { stdout: /Worker started/ },
      reuseExistingServer: false,
    },
    {
      command: 'pnpm exec next build && pnpm exec next start --port 3100',
      cwd: `${root}apps/web`,
      env: env(WEB_ENV),
      url: WEB_URL,
      timeout: 240_000,
      reuseExistingServer: false,
    },
  ],
});
