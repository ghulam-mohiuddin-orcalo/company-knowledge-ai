import { loadDatabaseConfigOrExit, loadEnvFileIfPresent } from '@cka/config';
import pg from 'pg';
import { isMainModule } from './cli.js';
import { describeDatabaseError } from './client.js';

/** Local demo identities: sign in to the mock IdP (`pnpm infra:auth`) with these usernames. */
export const DEMO_USERS = [
  { subject: 'demo-admin', role: 'ORG_ADMIN' },
  { subject: 'demo-member', role: 'MEMBER' },
] as const;
export const DEMO_ORGANIZATION = 'Demo Organization';

/**
 * Creates a demo organization with an admin and a member for local
 * development (there is no self-service onboarding in the MVP). Idempotent.
 * Users are linked to the mock IdP subjects on first sign-in.
 */
export async function seedDemo(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM organizations WHERE name = $1 ORDER BY created_at LIMIT 1',
      [DEMO_ORGANIZATION],
    );
    const organizationId =
      existing.rows[0]?.id ??
      (
        await client.query<{ id: string }>(
          'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
          [DEMO_ORGANIZATION],
        )
      ).rows[0]!.id;
    for (const { subject, role } of DEMO_USERS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (auth_subject, email, display_name) VALUES ($1, $2, $1)
         ON CONFLICT (auth_subject) DO UPDATE SET auth_subject = EXCLUDED.auth_subject
         RETURNING id`,
        [subject, `${subject}@example.test`],
      );
      await client.query(
        `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, user_id) DO NOTHING`,
        [organizationId, rows[0]!.id, role],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

// Local development only: `pnpm db:seed:demo`.
if (isMainModule(import.meta.url)) {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data with NODE_ENV=production');
    process.exit(1);
  }
  loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
  const { url } = loadDatabaseConfigOrExit();
  try {
    await seedDemo(url.reveal());
    console.log(
      `Demo data ready: "${DEMO_ORGANIZATION}" with users ${DEMO_USERS.map((u) => `${u.subject} (${u.role})`).join(', ')}`,
    );
  } catch (error) {
    console.error(`Demo seed failed: ${describeDatabaseError(error)}`);
    process.exit(1);
  }
}
