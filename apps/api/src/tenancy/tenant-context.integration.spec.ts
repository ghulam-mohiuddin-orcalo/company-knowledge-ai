import { OrganizationsService } from '../organizations/organizations.service.js';
import { startTestApi, type TestApi } from '../testing/test-api.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from '../testing/test-identity-provider.js';
import { UsersService } from '../users/users.service.js';
import { MembershipsService } from './memberships.service.js';
import { TenantScope } from './tenant-scope.js';

describe('request principal and active tenant (E1-T03)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let orgA: { id: string };
  let orgB: { id: string };

  const me = async (
    subject: string,
    headers: Record<string, string> = {},
    query = '',
  ) =>
    api.request(`/v1/me${query}`, { token: await idp.token(subject), headers });

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp);

    const organizations = api.app.get(OrganizationsService);
    const memberships = api.app.get(MembershipsService);
    const users = api.app.get(UsersService);
    const user = (subject: string) =>
      users.resolveVerifiedIdentity({
        subject,
        email: `${subject}@example.test`,
        displayName: undefined,
      });

    orgA = await organizations.createOrganization('Org A');
    orgB = await organizations.createOrganization('Org B');
    const suspended = await organizations.createOrganization('Suspended Org');
    await organizations.setStatus(suspended.id, 'SUSPENDED');

    await memberships.addMember(
      TenantScope.forSystem(orgA.id),
      (await user('alice')).userId,
      'ORG_ADMIN',
    );
    await memberships.addMember(
      TenantScope.forSystem(orgB.id),
      (await user('bob')).userId,
      'MEMBER',
    );
    const multi = (await user('multi')).userId;
    await memberships.addMember(
      TenantScope.forSystem(orgA.id),
      multi,
      'MEMBER',
    );
    await memberships.addMember(
      TenantScope.forSystem(orgB.id),
      multi,
      'ORG_ADMIN',
    );
    await memberships.addMember(
      TenantScope.forSystem(suspended.id),
      (await user('sus')).userId,
      'MEMBER',
    );
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  it('resolves the principal from the membership', async () => {
    const response = await me('alice');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      activeOrganization: { id: orgA.id, name: 'Org A', role: 'ORG_ADMIN' },
    });
  });

  it('refuses a header naming another tenant, without revealing data', async () => {
    const response = await me('alice', { 'x-organization-id': orgB.id });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'You are not a member of this organization.',
      },
    });
    expect(response.text).not.toContain('Org B');
  });

  it('treats a non-existent organization exactly like a foreign one', async () => {
    const foreign = await me('alice', { 'x-organization-id': orgB.id });
    const missing = await me('alice', {
      'x-organization-id': '00000000-0000-4000-8000-000000000000',
    });

    expect(missing.status).toBe(foreign.status);
    expect(missing.body).toEqual(foreign.body);
  });

  it('ignores organization IDs in the query string', async () => {
    const response = await me(
      'alice',
      {},
      `?organizationId=${orgB.id}&organization_id=${orgB.id}`,
    );

    expect(response.body).toMatchObject({
      activeOrganization: { id: orgA.id },
    });
  });

  it('lists the caller’s own organizations for selection', async () => {
    const response = await me('multi');

    expect(
      (response.body as { organizations: unknown[] }).organizations,
    ).toEqual([
      { id: orgA.id, name: 'Org A', role: 'MEMBER', status: 'ACTIVE' },
      { id: orgB.id, name: 'Org B', role: 'ORG_ADMIN', status: 'ACTIVE' },
    ]);
  });

  it('lets a multi-organization user select among their own memberships', async () => {
    const unselected = await me('multi');
    const inA = await me('multi', { 'x-organization-id': orgA.id });
    const inB = await me('multi', { 'x-organization-id': orgB.id });

    expect(unselected.body).toMatchObject({ activeOrganization: null });
    expect(inA.body).toMatchObject({
      activeOrganization: { id: orgA.id, role: 'MEMBER' },
    });
    expect(inB.body).toMatchObject({
      activeOrganization: { id: orgB.id, role: 'ORG_ADMIN' },
    });
  });

  it('gives users without a membership no tenant', async () => {
    const response = await me('newcomer');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ activeOrganization: null });
  });

  it('gives members of a suspended organization no tenant', async () => {
    const implicit = await me('sus');

    expect(implicit.body).toMatchObject({ activeOrganization: null });
  });

  it('rejects a malformed organization header', async () => {
    const response = await me('alice', { 'x-organization-id': 'nope' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });
});
