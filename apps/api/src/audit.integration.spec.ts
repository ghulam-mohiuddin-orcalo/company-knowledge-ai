import { auditEvents, type Database } from '@cka/database';
import { eq } from 'drizzle-orm';
import { DATABASE } from './database/database.module.js';
import { startTestApi, type TestApi } from './testing/test-api.js';
import {
  seedTenantFixtures,
  type TenantFixtures,
} from './testing/tenant-fixtures.js';
import {
  createTestDatabase,
  type TestDatabase,
} from './testing/test-database.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from './testing/test-identity-provider.js';

describe('audit events (E8-T02)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;
  let database: Database;

  const eventsFor = (action: string) =>
    database.select().from(auditEvents).where(eq(auditEvents.action, action));
  const upload = async (token: string, name: string) => {
    const form = new FormData();
    form.append(
      'file',
      new Blob(['Confidential audit content'], { type: 'text/plain' }),
      name,
    );
    return api.request('/v1/documents', { method: 'POST', body: form, token });
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp);
    fx = await seedTenantFixtures(api.app, idp, 'aud');
    database = api.app.get(DATABASE);
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  it('records user provisioning on first sign-in only', async () => {
    const first = await api.request('/v1/me', {
      token: await idp.token('aud-newcomer'),
    });
    await api.request('/v1/me', { token: await idp.token('aud-newcomer') });

    const events = (await eventsFor('USER_PROVISIONED')).filter(
      (e) => e.requestId === first.requestId,
    );
    expect(events).toEqual([
      expect.objectContaining({
        organizationId: null,
        targetType: 'user',
        actorUserId: expect.any(String),
      }),
    ]);
    expect(events[0]!.targetId).toBe(events[0]!.actorUserId);
  });

  it('records uploads and deletions, tenant-scoped and correlated', async () => {
    const response = await upload(
      await fx.adminA.token(),
      'board-minutes-secret.txt',
    );
    const documentId = (response.body as { id: string }).id;
    const deleted = await api.request(`/v1/documents/${documentId}`, {
      method: 'DELETE',
      token: await fx.adminA.token(),
    });
    await api.request(`/v1/documents/${documentId}`, {
      method: 'DELETE',
      token: await fx.adminA.token(),
    });

    const uploads = (await eventsFor('DOCUMENT_UPLOADED')).filter(
      (e) => e.targetId === documentId,
    );
    expect(uploads).toEqual([
      expect.objectContaining({
        organizationId: fx.orgA.id,
        actorUserId: fx.adminA.userId,
        targetType: 'document',
        metadata: { mimeType: 'text/plain', sizeBytes: 26 },
        requestId: response.requestId,
      }),
    ]);
    // Repeated deletes are idempotent and audited once.
    const deletions = (await eventsFor('DOCUMENT_DELETED')).filter(
      (e) => e.targetId === documentId,
    );
    expect(deletions).toEqual([
      expect.objectContaining({
        organizationId: fx.orgA.id,
        actorUserId: fx.adminA.userId,
        requestId: deleted.requestId,
      }),
    ]);
  });

  it('keeps each tenant’s events in its own organization', async () => {
    const response = await upload(await fx.adminB.token(), 'org-b.txt');
    const documentId = (response.body as { id: string }).id;

    const [event] = (await eventsFor('DOCUMENT_UPLOADED')).filter(
      (e) => e.targetId === documentId,
    );
    expect(event).toMatchObject({
      organizationId: fx.orgB.id,
      actorUserId: fx.adminB.userId,
    });
  });

  it('records privileged platform actions', async () => {
    const response = await api.request('/v1/platform/organizations', {
      token: await fx.platformAdmin.token(),
    });

    const [event] = (await eventsFor('PLATFORM_ORGANIZATIONS_LISTED')).filter(
      (e) => e.requestId === response.requestId,
    );
    expect(event).toMatchObject({
      organizationId: null,
      actorUserId: fx.platformAdmin.userId,
      metadata: { count: expect.any(Number) },
    });
  });

  it('stores no secrets, filenames or document content', async () => {
    const all = JSON.stringify(await database.select().from(auditEvents));

    for (const forbidden of [
      'board-minutes-secret',
      'Confidential audit content',
      'Bearer',
      'eyJ',
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });
});
