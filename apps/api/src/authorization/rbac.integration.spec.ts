import { startTestApi, type TestApi } from '../testing/test-api.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from '../testing/test-identity-provider.js';
import {
  seedTenantFixtures,
  type TenantFixtures,
} from '../testing/tenant-fixtures.js';

const FORBIDDEN = {
  error: {
    code: 'FORBIDDEN',
    message: 'You do not have permission to perform this action.',
  },
};

describe('RBAC policies (E1-T04)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp);
    fx = await seedTenantFixtures(api.app, idp, 'rbac');
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  describe('ORG_ADMIN routes', () => {
    it('deny a MEMBER calling the API directly with 403', async () => {
      const response = await api.request('/v1/organization/members', {
        token: await fx.memberA.token(),
      });

      expect(response.status).toBe(403);
      expect(response.body).toEqual(FORBIDDEN);
    });

    it('allow an ORG_ADMIN', async () => {
      const response = await api.request('/v1/organization/members', {
        token: await fx.adminA.token(),
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        expect.objectContaining({
          userId: fx.adminA.userId,
          role: 'ORG_ADMIN',
        }),
        expect.objectContaining({ userId: fx.memberA.userId, role: 'MEMBER' }),
      ]);
    });

    it('deny a platform admin without a membership', async () => {
      const response = await api.request('/v1/organization/members', {
        token: await fx.platformAdmin.token(),
      });

      expect(response.status).toBe(403);
    });

    it('require authentication first', async () => {
      expect((await api.request('/v1/organization/members')).status).toBe(401);
    });
  });

  describe('MEMBER routes', () => {
    it('allow MEMBERs and ORG_ADMINs of an active organization', async () => {
      for (const user of [fx.memberA, fx.adminA]) {
        const response = await api.request('/v1/organization', {
          token: await user.token(),
        });
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ id: fx.orgA.id });
      }
    });

    it('deny users without a membership, including platform admins', async () => {
      for (const user of [fx.outsider, fx.platformAdmin]) {
        const response = await api.request('/v1/organization', {
          token: await user.token(),
        });
        expect(response.status).toBe(403);
      }
    });

    it('deny members of a suspended organization', async () => {
      const response = await api.request('/v1/organization', {
        token: await fx.suspended.token(),
      });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: { code: 'ORGANIZATION_SUSPENDED' },
      });
    });
  });

  describe('PLATFORM_ADMIN routes', () => {
    it('allow platform admins', async () => {
      const response = await api.request('/v1/platform/organizations', {
        token: await fx.platformAdmin.token(),
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: fx.orgA.id, status: 'ACTIVE' }),
          expect.objectContaining({
            id: fx.suspendedOrg.id,
            status: 'SUSPENDED',
          }),
        ]),
      );
    });

    it('deny organization admins and members', async () => {
      for (const user of [fx.adminA, fx.memberA, fx.outsider]) {
        const response = await api.request('/v1/platform/organizations', {
          token: await user.token(),
        });
        expect(response.status).toBe(403);
        expect(response.body).toEqual(FORBIDDEN);
      }
    });

    it('ignore role claims asserted by the identity provider', async () => {
      const token = await idp.token(fx.memberA.subject, {
        email: `${fx.memberA.subject}@example.test`,
        roles: ['PLATFORM_ADMIN', 'ORG_ADMIN'],
        role: 'PLATFORM_ADMIN',
        is_platform_admin: true,
        isPlatformAdmin: true,
      });

      expect(
        (await api.request('/v1/platform/organizations', { token })).status,
      ).toBe(403);
      expect(
        (await api.request('/v1/organization/members', { token })).status,
      ).toBe(403);
    });
  });
});
