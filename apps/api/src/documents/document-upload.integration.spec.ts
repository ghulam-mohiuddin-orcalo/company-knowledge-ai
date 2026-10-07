import { type Database, documents, ingestionJobs } from '@cka/database';
import { documentObjectKey, type ObjectStorage } from '@cka/storage';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';
import { OBJECT_STORAGE } from '../storage/storage.module.js';
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

const MAX_BYTES = 2048;

export function formWithFile(
  name: string,
  content: string | Buffer,
  type = 'text/plain',
): FormData {
  const form = new FormData();
  form.append('file', new Blob([content], { type }), name);
  return form;
}

describe('document upload (E2-T03)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;
  let database: Database;
  let storage: ObjectStorage;

  const upload = async (form: FormData, token?: string, headers = {}) =>
    api.request('/v1/documents', {
      method: 'POST',
      body: form,
      token: token ?? (await fx.adminA.token()),
      headers,
    });

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp, {
      UPLOAD_MAX_BYTES: String(MAX_BYTES),
    });
    fx = await seedTenantFixtures(api.app, idp, 'upl');
    database = api.app.get(DATABASE);
    storage = api.app.get(OBJECT_STORAGE);
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  it('accepts a valid TXT upload and returns its queued status', async () => {
    const response = await upload(formWithFile('notes.txt', 'Hello knowledge'));

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      filename: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 15,
      status: 'QUEUED',
      errorCode: null,
      uploadedBy: { id: fx.adminA.userId, name: 'admin-a' },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(response.text).not.toContain('org/');
  });

  it.each([
    ['report.pdf', Buffer.from('%PDF-1.4\n%test'), 'application/pdf'],
    [
      'brief.docx',
      Buffer.concat([
        Buffer.from('PK\x03\x04'),
        Buffer.from('word/document.xml'),
      ]),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  ])('accepts %s', async (name, content, type) => {
    const response = await upload(formWithFile(name, content, type));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ mimeType: type, status: 'QUEUED' });
  });

  it('stores the original privately under a server-generated tenant key and queues one job', async () => {
    const response = await upload(
      formWithFile('../../../org/other/evil.txt', 'stored content'),
    );
    const { id, filename } = response.body as { id: string; filename: string };

    expect(filename).toBe('evil.txt');
    const [row] = await database
      .select()
      .from(documents)
      .where(eq(documents.id, id));
    expect(row).toMatchObject({
      organizationId: fx.orgA.id,
      uploadedBy: fx.adminA.userId,
      storageKey: documentObjectKey(fx.orgA.id, id),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect((await storage.getObject(row!.storageKey)).toString()).toBe(
      'stored content',
    );
    const jobs = await database
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.documentId, id));
    expect(jobs).toEqual([
      expect.objectContaining({
        organizationId: fx.orgA.id,
        status: 'QUEUED',
        attempt: 0,
        idempotencyKey: `document:${id}:ingest`,
      }),
    ]);
  });

  it('rejects members with 403 and stores nothing', async () => {
    const before = await database.select().from(documents);
    const response = await upload(
      formWithFile('member.txt', 'x'),
      await fx.memberA.token(),
    );

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await database.select().from(documents)).toHaveLength(before.length);
  });

  it('requires authentication', async () => {
    const response = await api.request('/v1/documents', {
      method: 'POST',
      body: formWithFile('anon.txt', 'x'),
    });

    expect(response.status).toBe(401);
  });

  it.each([
    [
      'an unsupported type',
      formWithFile('tool.exe', 'MZ', 'application/octet-stream'),
    ],
    [
      'a disguised file',
      formWithFile('fake.pdf', 'not a pdf', 'application/pdf'),
    ],
    ['a binary .txt', formWithFile('bin.txt', Buffer.from([1, 0, 2]))],
  ])('rejects %s with DOCUMENT_UNSUPPORTED_TYPE', async (_, form) => {
    const response = await upload(form);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'DOCUMENT_UNSUPPORTED_TYPE' },
    });
  });

  it('rejects oversized files with 413', async () => {
    const response = await upload(
      formWithFile('big.txt', 'a'.repeat(MAX_BYTES + 1)),
    );

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({
      error: { code: 'DOCUMENT_TOO_LARGE' },
    });
  });

  it('accepts a file exactly at the size limit', async () => {
    const response = await upload(
      formWithFile('max.txt', 'a'.repeat(MAX_BYTES)),
    );

    expect(response.status).toBe(201);
  });

  it('rejects empty files and missing files', async () => {
    const empty = await upload(formWithFile('empty.txt', ''));
    const missing = await upload(new FormData());

    expect(empty.status).toBe(400);
    expect(empty.body).toMatchObject({ error: { code: 'DOCUMENT_EMPTY' } });
    expect(missing.status).toBe(400);
  });

  it('rejects client-supplied tenant fields and foreign tenant selection', async () => {
    const form = formWithFile('x.txt', 'x');
    form.append('organizationId', fx.orgB.id);
    const withField = await upload(form);
    const foreignHeader = await upload(formWithFile('y.txt', 'y'), undefined, {
      'x-organization-id': fx.orgB.id,
    });

    expect(withField.status).toBe(400);
    expect(foreignHeader.status).toBe(403);
    const orgBDocuments = await database
      .select()
      .from(documents)
      .where(eq(documents.organizationId, fx.orgB.id));
    expect(orgBDocuments).toEqual([]);
  });
});
