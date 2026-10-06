import { randomUUID } from 'node:crypto';
import { startTestApi, type TestApi } from '../testing/test-api.js';
import {
  expectDeniedWithoutLeak,
  expectNoLeak,
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

interface ListBody {
  items: Array<{ id: string; filename: string }>;
  nextCursor: string | null;
}

describe('document list and detail (E2-T04)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;
  const orgADocs: string[] = [];
  let orgBDoc: string;

  const uploadAs = async (token: string, name: string) => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([`content of ${name}`], { type: 'text/plain' }),
      name,
    );
    const response = await api.request('/v1/documents', {
      method: 'POST',
      body: form,
      token,
    });
    return (response.body as { id: string }).id;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp);
    fx = await seedTenantFixtures(api.app, idp, 'lst');
    const adminA = await fx.adminA.token();
    for (const name of ['a1.txt', 'a2.txt', 'a3.txt']) {
      orgADocs.push(await uploadAs(adminA, name));
    }
    orgBDoc = await uploadAs(await fx.adminB.token(), 'org-b-secret-plan.txt');
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  it('lists only the caller tenant documents, newest first, for members and admins', async () => {
    for (const user of [fx.memberA, fx.adminA]) {
      const response = await api.request('/v1/documents', {
        token: await user.token(),
      });

      expect(response.status).toBe(200);
      const body = response.body as ListBody;
      expect(body.items.map((d) => d.id)).toEqual([...orgADocs].reverse());
      expect(body.nextCursor).toBeNull();
      expectNoLeak(response, [orgBDoc, 'org-b-secret-plan', fx.orgB.id]);
    }
  });

  it('paginates with an opaque cursor', async () => {
    const token = await fx.memberA.token();
    const first = (await api.request('/v1/documents?limit=2', { token }))
      .body as ListBody;
    const second = (
      await api.request(`/v1/documents?limit=2&cursor=${first.nextCursor}`, {
        token,
      })
    ).body as ListBody;

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.items.map((d) => d.id)).toEqual([orgADocs[0]]);
    expect(second.nextCursor).toBeNull();
  });

  it('excludes storage keys, hashes and internal fields', async () => {
    const response = await api.request(`/v1/documents/${orgADocs[0]}`, {
      token: await fx.memberA.token(),
    });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body as object).sort()).toEqual([
      'createdAt',
      'errorCode',
      'filename',
      'id',
      'mimeType',
      'sizeBytes',
      'status',
      'updatedAt',
      'uploadedBy',
    ]);
    expect(response.text).not.toMatch(/storage|sha256|org\//i);
  });

  it('Org A cannot read an Org B document; foreign looks like unknown', async () => {
    const token = await fx.adminA.token();
    const foreign = await api.request(`/v1/documents/${orgBDoc}`, { token });
    const unknown = await api.request(`/v1/documents/${randomUUID()}`, {
      token,
    });

    expectDeniedWithoutLeak(foreign, 404, [
      orgBDoc,
      'org-b-secret-plan',
      fx.orgB.id,
    ]);
    expect(foreign.body).toEqual(unknown.body);
  });

  it('cannot be redirected to Org B through header or query parameters', async () => {
    const token = await fx.adminA.token();
    const header = await api.request('/v1/documents', {
      token,
      headers: { 'x-organization-id': fx.orgB.id },
    });
    const query = await api.request(
      `/v1/documents?organizationId=${fx.orgB.id}`,
      { token },
    );

    expect(header.status).toBe(403);
    expectNoLeak(header, [orgBDoc]);
    expect(query.status).toBe(200);
    expectNoLeak(query, [orgBDoc, 'org-b-secret-plan']);
  });

  it('denies users without a membership and rejects bad paging input', async () => {
    const outsider = await api.request('/v1/documents', {
      token: await fx.outsider.token(),
    });
    const badLimit = await api.request('/v1/documents?limit=1000', {
      token: await fx.memberA.token(),
    });

    expect(outsider.status).toBe(403);
    expect(badLimit.status).toBe(400);
  });
});
