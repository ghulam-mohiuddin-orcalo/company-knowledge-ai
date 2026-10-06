import { type AppConfig, loadConfig } from '@cka/config';

/** Valid configuration for tests; no services are contacted until used. */
export function createTestConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    APP_PUBLIC_URL: 'http://localhost:3000',
    API_PUBLIC_URL: 'http://localhost:3001',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'test',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    ...overrides,
  });
}
