import { defineConfig, devices } from '@playwright/test';

/**
 * Deployment smoke test (E9): the demo path (docs/demo/DEMO_SCRIPT.md) against
 * an already-deployed environment that signs in through the mock IdP, e.g. the
 * rehearsal (`infra/deploy/rehearsal.sh up`). Starts no servers.
 *
 *   DEPLOY_APP_URL   web URL (default https://app.localhost)
 *   DEPLOY_API_URL   API URL (default https://api.localhost)
 *   DEPLOY_IDP_URL   mock IdP issuer (default https://auth.localhost/default)
 *   DEPLOY_LOCAL_CA  1 = accept the rehearsal's local CA in the browser (TLS
 *                    validity is verified separately by infra/deploy/smoke.sh)
 */
export default defineConfig({
  testDir: './deploy',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.DEPLOY_APP_URL ?? 'https://app.localhost',
    ignoreHTTPSErrors: process.env.DEPLOY_LOCAL_CA === '1',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
