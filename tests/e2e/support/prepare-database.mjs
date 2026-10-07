// Recreates, migrates and seeds the E2E database before Playwright starts the
// API and worker. Users are pre-created with the mock IdP usernames as subjects;
// signing in links the browser session to them (JIT mapping updates the profile).
import { runMigrations } from '@cka/database';
import pg from 'pg';

const base = new URL(
  process.env.DATABASE_URL ??
    'postgresql://cka:cka_local_dev@127.0.0.1:5432/company_knowledge',
);
const e2e = new URL(base);
e2e.pathname = '/cka_e2e';
const admin = new URL(base);
admin.pathname = '/postgres';

async function sql(url, text, values = []) {
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

await sql(admin, 'DROP DATABASE IF EXISTS cka_e2e WITH (FORCE)');
await sql(admin, 'CREATE DATABASE cka_e2e');
await runMigrations(e2e.toString());

const org = async (name) =>
  (
    await sql(
      e2e,
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
      [name],
    )
  ).rows[0].id;
const user = async (subject, platformAdmin = false) =>
  (
    await sql(
      e2e,
      'INSERT INTO users (auth_subject, email, display_name, is_platform_admin) VALUES ($1, $2, $1, $3) RETURNING id',
      [subject, `${subject}@example.test`, platformAdmin],
    )
  ).rows[0].id;
const member = (organizationId, userId, role) =>
  sql(
    e2e,
    'INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)',
    [organizationId, userId, role],
  );

const northwind = await org('Northwind Analytics');
const contoso = await org('Contoso Legal');
await member(northwind, await user('e2e-admin'), 'ORG_ADMIN');
await member(northwind, await user('e2e-member'), 'MEMBER');
const multi = await user('e2e-multi');
await member(northwind, multi, 'MEMBER');
await member(contoso, multi, 'MEMBER');
await member(contoso, await user('e2e-other-admin'), 'ORG_ADMIN');
await user('e2e-platform', true);
await user('e2e-outsider');
console.log('E2E database ready');
