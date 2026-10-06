import { randomUUID } from 'node:crypto';
import { loadDatabaseConfig, loadEnvFileIfPresent } from '@cka/config';
import { runMigrations } from '@cka/database';
import pg from 'pg';

export interface TestDatabase {
  url: string;
  drop(): Promise<void>;
}

/**
 * Creates and migrates a brand-new database for one test file, so tests never
 * share or depend on existing data. Requires `pnpm infra:up` (or CI's database job).
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  loadEnvFileIfPresent(new URL('../../../../.env', import.meta.url));
  const baseUrl = loadDatabaseConfig().url.reveal();
  const name = `cka_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;

  const admin = async (sql: string): Promise<void> => {
    const client = new pg.Client({ connectionString: baseUrl });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };

  await admin(`CREATE DATABASE "${name}"`);
  await runMigrations(url.toString());
  return {
    url: url.toString(),
    drop: () => admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
  };
}
