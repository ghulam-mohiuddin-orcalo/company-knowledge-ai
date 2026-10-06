import { randomUUID } from 'node:crypto';
import { startTestApi, type TestApi } from '../testing/test-api.js';
import {
  expectDeniedWithoutLeak,
  expectNoLeak,
  foreignTenantMarkers,
} from '../testing/tenant-boundary.js';
import {
  seedTenantFixtures,
  type TenantFixtures,
} from '../testing/tenant-fixtures.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from '../testing/test-identity-provider.js';

/**
 * Cross-tenant security gate (E1-T06). Org A users must never read or act on
 * Org B through IDs, headers, query parameters or token claims. Add cases here
 * for every new tenant-owned aggregate (TDD §8.3).
 */
describe('cross-tenant isolation (E1-T06)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;
  let orgB: string[];

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp);
    fx = await seedTenantFixtures(api.app, idp, 'sec');
    orgB = foreignTenantMarkers(fx);
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  describe('documents (E2)', () => {
    let orgBDocument: string;
    const upload = async (token: string, name: string) => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([`secret of ${name}`], { type: 'text/plain' }),
        name,
      );
      return api.request('/v1/documents', {
        method: 'POST',
        body: form,
        token,
      });
    };

    beforeAll(async () => {
      const response = await upload(
        await fx.adminB.token(),
        'org-b-board-minutes.txt',
      );
      orgBDocument = (response.body as { id: string }).id;
    });

    it('Org A cannot read, delete or list Org B documents', async () => {
      const markers = [...orgB, orgBDocument, 'org-b-board-minutes'];
      for (const user of [fx.adminA, fx.memberA]) {
        const token = await user.token();
        expectDeniedWithoutLeak(
          await api.request(`/v1/documents/${orgBDocument}`, { token }),
          404,
          markers,
        );
        expectNoLeak(await api.request('/v1/documents', { token }), markers);
      }
      expectDeniedWithoutLeak(
        await api.request(`/v1/documents/${orgBDocument}`, {
          method: 'DELETE',
          token: await fx.adminA.token(),
        }),
        404,
        markers,
      );
      const stillThere = await api.request(`/v1/documents/${orgBDocument}`, {
        token: await fx.adminB.token(),
      });
      expect(stillThere.status).toBe(200);
    });

    it('Org A cannot upload into Org B', async () => {
      const form = new FormData();
      form.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
      const response = await api.request('/v1/documents', {
        method: 'POST',
        body: form,
        token: await fx.adminA.token(),
        headers: { 'x-organization-id': fx.orgB.id },
      });

      expectDeniedWithoutLeak(response, 403, orgB);
      const orgBList = await api.request('/v1/documents', {
        token: await fx.adminB.token(),
      });
      expect((orgBList.body as { items: unknown[] }).items).toHaveLength(1);
    });

    it('document responses never expose storage keys', async () => {
      const response = await upload(await fx.adminA.token(), 'a.txt');

      expect(response.status).toBe(201);
      expect(response.text).not.toMatch(/org\/|storage|sha256/i);
    });
  });

  describe('direct object references (IDOR)', () => {
    it('Org A admin cannot read an Org B membership by ID', async () => {
      const response = await api.request(
        `/v1/organization/members/${fx.adminB.membershipId}`,
        { token: await fx.adminA.token() },
      );

      expectDeniedWithoutLeak(response, 404, orgB);
    });

    it('a foreign ID is indistinguishable from an unknown ID', async () => {
      const token = await fx.adminA.token();
      const foreign = await api.request(
        `/v1/organization/members/${fx.memberB.membershipId}`,
        { token },
      );
      const unknown = await api.request(
        `/v1/organization/members/${randomUUID()}`,
        { token },
      );

      expect(foreign.status).toBe(unknown.status);
      expect(foreign.body).toEqual(unknown.body);
    });

    it('Org A admin can read its own membership by ID', async () => {
      const response = await api.request(
        `/v1/organization/members/${fx.memberA.membershipId}`,
        { token: await fx.adminA.token() },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ userId: fx.memberA.userId });
    });
  });

  describe('tenant selection', () => {
    it('Org A users cannot select Org B with the organization header', async () => {
      const paths = [
        '/v1/organization',
        '/v1/organization/members',
        `/v1/organization/members/${fx.adminB.membershipId}`,
      ];
      for (const user of [fx.adminA, fx.memberA]) {
        for (const path of paths) {
          const response = await api.request(path, {
            token: await user.token(),
            headers: { 'x-organization-id': fx.orgB.id },
          });
          expectDeniedWithoutLeak(response, 403, orgB);
        }
      }
    });

    it('selecting a foreign organization looks the same as a non-existent one', async () => {
      const token = await fx.adminA.token();
      const foreign = await api.request('/v1/organization/members', {
        token,
        headers: { 'x-organization-id': fx.orgB.id },
      });
      const missing = await api.request('/v1/organization/members', {
        token,
        headers: { 'x-organization-id': randomUUID() },
      });

      expect(foreign.status).toBe(missing.status);
      expect(foreign.body).toEqual(missing.body);
    });

    it('ignores tenant IDs supplied in the query string', async () => {
      const response = await api.request(
        `/v1/organization/members?organizationId=${fx.orgB.id}&organization_id=${fx.orgB.id}&orgId=${fx.orgB.id}`,
        { token: await fx.adminA.token() },
      );

      expect(response.status).toBe(200);
      expectNoLeak(response, orgB);
      expect(response.body).toEqual([
        expect.objectContaining({ userId: fx.adminA.userId }),
        expect.objectContaining({ userId: fx.memberA.userId }),
      ]);
    });

    it('ignores tenant IDs supplied in token claims', async () => {
      const token = await idp.token(fx.adminA.subject, {
        email: `${fx.adminA.subject}@example.test`,
        org_id: fx.orgB.id,
        organizationId: fx.orgB.id,
        organization_id: fx.orgB.id,
      });
      const response = await api.request('/v1/organization/members', {
        token,
      });

      expect(response.status).toBe(200);
      expectNoLeak(response, orgB);
    });
  });

  describe('listings', () => {
    it('Org A member listings never include Org B users', async () => {
      const response = await api.request('/v1/organization/members', {
        token: await fx.adminA.token(),
      });

      expect(response.status).toBe(200);
      expectNoLeak(response, orgB);
    });

    it('Org B listings never include Org A users (symmetry)', async () => {
      const response = await api.request('/v1/organization/members', {
        token: await fx.adminB.token(),
      });

      expect(response.status).toBe(200);
      expectNoLeak(response, [fx.orgA.id, fx.adminA.userId, fx.memberA.userId]);
    });
  });

  describe('privilege boundaries', () => {
    it('members cannot use admin APIs of their own organization', async () => {
      const response = await api.request('/v1/organization/members', {
        token: await fx.memberA.token(),
      });

      expectDeniedWithoutLeak(response, 403, orgB);
    });

    it('platform admins get no implicit access to tenant data', async () => {
      const variants: Record<string, string>[] = [
        {},
        { 'x-organization-id': fx.orgA.id },
      ];
      for (const headers of variants) {
        const response = await api.request('/v1/organization/members', {
          token: await fx.platformAdmin.token(),
          headers,
        });
        expect(response.status).toBe(403);
        expectNoLeak(response, [fx.adminA.userId, fx.memberA.userId]);
      }
    });

    it('platform listings expose organization metadata only', async () => {
      const response = await api.request('/v1/platform/organizations', {
        token: await fx.platformAdmin.token(),
      });

      expect(response.status).toBe(200);
      expectNoLeak(response, [
        fx.adminA.userId,
        fx.adminB.userId,
        'example.test',
      ]);
    });

    it('members of a suspended organization are refused', async () => {
      const response = await api.request('/v1/organization', {
        token: await fx.suspended.token(),
        headers: { 'x-organization-id': fx.suspendedOrg.id },
      });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: { code: 'ORGANIZATION_SUSPENDED' },
      });
    });
  });
});
