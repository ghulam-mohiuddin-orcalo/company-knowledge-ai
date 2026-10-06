import { loadDatabaseConfig, loadEnvFileIfPresent } from '@cka/config';
import {
  createTestDatabase as createDatabase,
  type TestDatabase,
} from '@cka/database/testing';

export type { TestDatabase };

/** A brand-new migrated database for one test file (needs `pnpm infra:up`). */
export async function createTestDatabase(): Promise<TestDatabase> {
  loadEnvFileIfPresent(new URL('../../../../.env', import.meta.url));
  return createDatabase(loadDatabaseConfig().url.reveal());
}
