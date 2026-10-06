import { randomUUID } from 'node:crypto';
import { type Database, documents, ingestionJobs } from '@cka/database';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';
import { startTestApi, type TestApi } from '../testing/test-api.js';
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

describe('document deletion API (E2-T05)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;
  let database: Database;

  const uploadAs = async (token: string, name = 'doc.txt') => {
    const form = new FormData();
    form.append('file', new Blob(['content'], { type: 'text/plain' }), name);
    const response = await api.request('/v1/documents', {
      method: 'POST',
      body: form,
      token,
    });
    return (response.body as { id: string }).id;
  };
  const remove = async (id: string, token: string) =>
    api.request(`/v1/documents/${id}`, { method: 'DELETE', token });
  const statusOf = async (id: string) =>
    (await database.select().from(documents).where(eq(documents.id, id)))[0]!
      .status;

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp);
    fx = await seedTenantFixtures(api.app, idp, 'del');
    database = api.app.get(DATABASE);
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  it('makes the document non-retrievable immediately and cancels queued ingestion', async () => {
    const admin = await fx.adminA.token();
    const id = await uploadAs(admin);

    const response = await remove(id, admin);

    expect(response.status).toBe(204);
    expect(await statusOf(id)).toBe('DELETING');
    expect(
      (await api.request(`/v1/documents/${id}`, { token: admin })).status,
    ).toBe(404);
    const list = await api.request('/v1/documents', { token: admin });
    expect(list.text).not.toContain(id);
    const [job] = await database
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.documentId, id));
    expect(job!.status).toBe('CANCELLED');
  });

  it('is idempotent', async () => {
    const admin = await fx.adminA.token();
    const id = await uploadAs(admin);

    expect((await remove(id, admin)).status).toBe(204);
    expect((await remove(id, admin)).status).toBe(204);
    await database
      .update(documents)
      .set({ status: 'DELETED' })
      .where(eq(documents.id, id));
    expect((await remove(id, admin)).status).toBe(204);
  });

  it('denies members', async () => {
    const id = await uploadAs(await fx.adminA.token());

    const response = await remove(id, await fx.memberA.token());

    expect(response.status).toBe(403);
    expect(await statusOf(id)).toBe('QUEUED');
  });

  it('denies cross-tenant deletes without revealing existence', async () => {
    const orgBDocument = await uploadAs(await fx.adminB.token());
    const adminA = await fx.adminA.token();

    const foreign = await remove(orgBDocument, adminA);
    const unknown = await remove(randomUUID(), adminA);
    const viaHeader = await api.request(`/v1/documents/${orgBDocument}`, {
      method: 'DELETE',
      token: adminA,
      headers: { 'x-organization-id': fx.orgB.id },
    });

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);
    expect(viaHeader.status).toBe(403);
    expect(await statusOf(orgBDocument)).toBe('QUEUED');
  });
});
