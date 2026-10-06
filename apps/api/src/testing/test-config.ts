import { loadConfig, requireAuthConfig } from '@cka/config';
import type { ApiConfig } from '../config/config.module.js';

/** Valid API configuration for tests; no services are contacted until used. */
export function createTestConfig(overrides: NodeJS.ProcessEnv = {}): ApiConfig {
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_PUBLIC_URL: 'http://localhost:3000',
    API_PUBLIC_URL: 'http://localhost:3001',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'test',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    AUTH_ISSUER_URL: 'https://idp.test/',
    AUTH_AUDIENCE: 'cka-api-test',
    AUTH_JWKS_URL: 'http://127.0.0.1:9/jwks.json',
    ...overrides,
  });
  return { config, auth: requireAuthConfig(config) };
}
