import { loadDatabaseConfig, loadEnvFileIfPresent } from '@cka/config';
import pg from 'pg';
import {
  parseMember,
  ProvisionError,
  provisionOrganization,
} from './provision.js';
import { createTestDatabase, type TestDatabase } from './testing.js';

loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));

describe('provisionOrganization (E9)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase(loadDatabaseConfig().url.reveal());
  });

  afterAll(async () => {
    await db?.drop();
  });

  async function query(text: string, values: unknown[] = []) {
    const client = new pg.Client({ connectionString: db.url });
    await client.connect();
    try {
      return (await client.query(text, values)).rows;
    } finally {
      await client.end();
    }
  }

  it('creates the organization and memberships once, auditing each change', async () => {
    const members = [
      parseMember('auth0|admin-1:admin@example.test', 'ORG_ADMIN'),
      parseMember('auth0|member-1:member@example.test', 'MEMBER'),
    ];

    const first = await provisionOrganization(db.url, 'Acme', members);
    const second = await provisionOrganization(db.url, ' Acme ', members);

    expect(first).toMatchObject({
      organizationCreated: true,
      membershipsGranted: 2,
    });
    expect(second).toEqual({
      organizationId: first.organizationId,
      organizationCreated: false,
      membershipsGranted: 0,
    });
    expect(
      await query(
        `SELECT u.auth_subject, u.email, m.role FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = $1 ORDER BY u.auth_subject`,
        [first.organizationId],
      ),
    ).toEqual([
      {
        auth_subject: 'auth0|admin-1',
        email: 'admin@example.test',
        role: 'ORG_ADMIN',
      },
      {
        auth_subject: 'auth0|member-1',
        email: 'member@example.test',
        role: 'MEMBER',
      },
    ]);
    expect(
      await query(
        `SELECT action, target_type, metadata FROM audit_events
          WHERE organization_id = $1 ORDER BY action`,
        [first.organizationId],
      ),
    ).toEqual([
      {
        action: 'MEMBERSHIP_GRANTED',
        target_type: 'user',
        metadata: { role: 'ORG_ADMIN', source: 'provision-cli' },
      },
      {
        action: 'MEMBERSHIP_GRANTED',
        target_type: 'user',
        metadata: { role: 'MEMBER', source: 'provision-cli' },
      },
      {
        action: 'ORGANIZATION_PROVISIONED',
        target_type: 'organization',
        metadata: { source: 'provision-cli' },
      },
    ]);
  });

  it('adds an existing user to another organization without changing them', async () => {
    const result = await provisionOrganization(db.url, 'Globex', [
      parseMember('auth0|member-1:changed@example.test', 'ORG_ADMIN'),
    ]);

    expect(result.membershipsGranted).toBe(1);
    expect(
      await query('SELECT email FROM users WHERE auth_subject = $1', [
        'auth0|member-1',
      ]),
    ).toEqual([{ email: 'member@example.test' }]);
  });

  it('refuses a role change and writes nothing', async () => {
    const before = await query('SELECT count(*)::int AS n FROM memberships');

    await expect(
      provisionOrganization(db.url, 'Acme', [
        parseMember('new-user:new@example.test', 'MEMBER'),
        parseMember('auth0|member-1:member@example.test', 'ORG_ADMIN'),
      ]),
    ).rejects.toThrow(ProvisionError);
    expect(await query('SELECT count(*)::int AS n FROM memberships')).toEqual(
      before,
    );
    expect(
      await query('SELECT 1 FROM users WHERE auth_subject = $1', ['new-user']),
    ).toEqual([]);
  });

  it('refuses an ambiguous organization name', async () => {
    await query("INSERT INTO organizations (name) VALUES ('Twin'), ('Twin')");

    await expect(provisionOrganization(db.url, 'Twin', [])).rejects.toThrow(
      /Several organizations/,
    );
  });
});

describe('parseMember', () => {
  it('splits on the last colon so subjects may contain colons', () => {
    expect(parseMember('urn:idp:42:ada@example.test', 'MEMBER')).toEqual({
      subject: 'urn:idp:42',
      email: 'ada@example.test',
      role: 'MEMBER',
    });
  });

  it.each(['no-email', ':a@example.test', 'sub:not-an-email', 'sub:'])(
    'rejects %s',
    (value) => {
      expect(() => parseMember(value, 'MEMBER')).toThrow(ProvisionError);
    },
  );
});
