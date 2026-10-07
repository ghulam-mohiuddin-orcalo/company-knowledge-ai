import { loadDatabaseConfig, loadEnvFileIfPresent } from '@cka/config';
import pg from 'pg';
import { seedDemo } from './seed-demo.js';
import { createTestDatabase, type TestDatabase } from './testing.js';

loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));

describe('seedDemo', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase(loadDatabaseConfig().url.reveal());
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('creates the demo organization and memberships once, however often it runs', async () => {
    await seedDemo(db.url);
    await seedDemo(db.url);

    const client = new pg.Client({ connectionString: db.url });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT o.name, u.auth_subject, m.role FROM memberships m
           JOIN organizations o ON o.id = m.organization_id
           JOIN users u ON u.id = m.user_id
          ORDER BY u.auth_subject`,
      );
      expect(rows).toEqual([
        {
          name: 'Demo Organization',
          auth_subject: 'demo-admin',
          role: 'ORG_ADMIN',
        },
        {
          name: 'Demo Organization',
          auth_subject: 'demo-member',
          role: 'MEMBER',
        },
      ]);
    } finally {
      await client.end();
    }
  });
});
