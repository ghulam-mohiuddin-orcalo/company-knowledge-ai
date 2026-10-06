import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from './migrate.js';

export interface TestDatabase {
  url: string;
  drop(): Promise<void>;
}

/**
 * Test helper: creates and migrates a brand-new database next to `baseUrl`, so
 * each test file starts from an empty schema. Never use outside tests.
 */
export async function createTestDatabase(
  baseUrl: string,
): Promise<TestDatabase> {
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
