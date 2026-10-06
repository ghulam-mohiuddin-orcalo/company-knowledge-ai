import { randomUUID } from 'node:crypto';
import { loadDatabaseConfig, loadEnvFileIfPresent } from '@cka/config';
import pg from 'pg';
import { runMigrations } from './migrate.js';

loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
const baseUrl = loadDatabaseConfig().url.reveal();

// Each run migrates a brand-new, empty database to prove migrations work from zero.
const databaseName = `cka_migration_test_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = (() => {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
})();

async function withClient<T>(
  connectionString: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe('database migrations', () => {
  beforeAll(async () => {
    await withClient(baseUrl, (client) =>
      client.query(`CREATE DATABASE "${databaseName}"`),
    );
  });

  afterAll(async () => {
    await withClient(baseUrl, (client) =>
      client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`),
    );
  });

  it('migrates an empty database forward from zero', async () => {
    await runMigrations(databaseUrl);

    await withClient(databaseUrl, async (client) => {
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'memberships',
        'organizations',
        'users',
      ]);

      const extension = await client.query(
        `SELECT 1 FROM pg_extension WHERE extname = 'vector'`,
      );
      expect(extension.rowCount).toBe(1);
    });
  });

  it('is safe to re-run when already up to date', async () => {
    await expect(runMigrations(databaseUrl)).resolves.toBeUndefined();
  });

  it('enforces membership constraints', async () => {
    await withClient(databaseUrl, async (client) => {
      const org = await client.query<{ id: string }>(
        `INSERT INTO organizations (name) VALUES ('Org A') RETURNING id`,
      );
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (auth_subject, email) VALUES ('sub-1', 'a@example.com') RETURNING id`,
      );
      const insertMembership = (role: string) =>
        client.query(
          `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`,
          [org.rows[0]!.id, user.rows[0]!.id, role],
        );

      await insertMembership('MEMBER');
      await expect(insertMembership('ORG_ADMIN')).rejects.toMatchObject({
        code: '23505', // unique_violation: one membership per user per organization
      });
      await expect(
        client.query(
          `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'MEMBER')`,
          [randomUUID(), user.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ code: '23503' }); // foreign_key_violation
      await expect(
        client.query(
          `INSERT INTO users (auth_subject, email) VALUES ('sub-1', 'b@example.com')`,
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});
