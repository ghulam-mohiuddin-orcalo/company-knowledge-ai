import {
  type AppConfig,
  loadConfig,
  requireEmbeddingConfig,
} from '@cka/config';
import type { WorkerConfig } from '../worker.module.js';

/** Worker configuration for tests, pointing at the local stack (infra/docker). */
export function createTestConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    APP_PUBLIC_URL: 'http://localhost:3000',
    API_PUBLIC_URL: 'http://localhost:3001',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'cka-documents-local',
    S3_ACCESS_KEY: 'cka_local_access',
    S3_SECRET_KEY: 'cka_local_secret',
    S3_FORCE_PATH_STYLE: 'true',
    ...overrides,
  });
}

/** Full worker configuration (with embedding settings) for module tests. */
export function createTestWorkerConfig(
  overrides: NodeJS.ProcessEnv = {},
): WorkerConfig {
  const config = createTestConfig({
    AI_PROVIDER: 'openai-compatible',
    AI_BASE_URL: 'http://127.0.0.1:9/v1',
    AI_EMBEDDING_MODEL: 'text-embedding-3-small',
    AI_EMBEDDING_DIMENSIONS: '1536',
    ...overrides,
  });
  return { config, embedding: requireEmbeddingConfig(config) };
}
