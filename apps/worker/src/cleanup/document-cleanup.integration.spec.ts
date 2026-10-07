import {
  createDatabase,
  createDatabasePool,
  type Database,
  type DatabasePool,
  documentChunks,
  documents,
  EMBEDDING_DIMENSIONS,
} from '@cka/database';
import {
  InMemoryObjectStorage,
  ObjectStorageError,
  S3ObjectStorage,
} from '@cka/storage';
import { eq } from 'drizzle-orm';
import { createTestConfig } from '../testing/test-config.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import { seedDocument, seedTenant } from '../testing/seed.js';
import { DocumentCleanupService } from './document-cleanup.service.js';

describe('document deletion cleanup (E2-T05)', () => {
  let testDb: TestDatabase;
  let pool: DatabasePool;
  let db: Database;
  let s3: S3ObjectStorage;
  let tenant: { organizationId: string; userId: string };

  const statusOf = async (id: string) =>
    (await db.select().from(documents).where(eq(documents.id, id)))[0]!.status;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    pool = createDatabasePool(testDb.url);
    db = createDatabase(pool);
    s3 = new S3ObjectStorage(createTestConfig().storage);
    tenant = await seedTenant(db);
  });

  afterAll(async () => {
    s3?.destroy();
    await pool?.end();
    await testDb?.drop();
  });

  it('removes the stored object and marks the document DELETED', async () => {
    const cleanup = new DocumentCleanupService(db, s3);
    const doc = await seedDocument(db, tenant, { status: 'DELETING' });
    await s3.putObject(doc.storageKey, Buffer.from('x'), {
      contentType: 'text/plain',
    });

    expect(await cleanup.cleanupNext()).toBe(true);

    expect(await statusOf(doc.documentId)).toBe('DELETED');
    await expect(s3.getObject(doc.storageKey)).rejects.toThrow(
      'Object not found',
    );
    expect(await cleanup.cleanupNext()).toBe(false);
  });

  it('removes the document chunks (retrieval data) in the same transaction', async () => {
    const doc = await seedDocument(db, tenant, {
      status: 'DELETING',
      withJob: true,
    });
    await db.insert(documentChunks).values(
      [0, 1].map((chunkIndex) => ({
        organizationId: tenant.organizationId,
        documentId: doc.documentId,
        ingestionJobId: doc.jobId!,
        chunkIndex,
        content: `chunk ${chunkIndex}`,
        tokenCount: 2,
        charStart: 0,
        charEnd: 7,
        embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1),
        embeddingModel: 'test',
      })),
    );
    const other = await seedDocument(db, tenant, {
      status: 'READY',
      withJob: true,
    });
    await db.insert(documentChunks).values({
      organizationId: tenant.organizationId,
      documentId: other.documentId,
      ingestionJobId: other.jobId!,
      chunkIndex: 0,
      content: 'keep me',
      tokenCount: 2,
      charStart: 0,
      charEnd: 7,
      embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1),
      embeddingModel: 'test',
    });

    expect(await new DocumentCleanupService(db, s3).cleanupNext()).toBe(true);

    const remaining = await db.select().from(documentChunks);
    expect(remaining.map((c) => c.documentId)).toEqual([other.documentId]);
    expect(await statusOf(doc.documentId)).toBe('DELETED');
  });

  it('is idempotent when the object is already gone', async () => {
    const cleanup = new DocumentCleanupService(db, s3);
    const doc = await seedDocument(db, tenant, { status: 'DELETING' });

    expect(await cleanup.cleanupNext()).toBe(true);
    expect(await statusOf(doc.documentId)).toBe('DELETED');
  });

  it('leaves the document DELETING for retry when storage fails', async () => {
    const failing = new InMemoryObjectStorage();
    failing.deleteObject = () =>
      Promise.reject(new ObjectStorageError('delete', 'ServiceUnavailable'));
    const doc = await seedDocument(db, tenant, { status: 'DELETING' });

    await expect(
      new DocumentCleanupService(db, failing).cleanupNext(),
    ).rejects.toThrow();
    expect(await statusOf(doc.documentId)).toBe('DELETING');

    expect(await new DocumentCleanupService(db, s3).cleanupNext()).toBe(true);
    expect(await statusOf(doc.documentId)).toBe('DELETED');
  });

  it('never touches documents that are not being deleted', async () => {
    const ready = await seedDocument(db, tenant, { status: 'READY' });
    await s3.putObject(ready.storageKey, Buffer.from('keep'), {
      contentType: 'text/plain',
    });

    expect(await new DocumentCleanupService(db, s3).cleanupNext()).toBe(false);
    expect(await statusOf(ready.documentId)).toBe('READY');
    expect((await s3.getObject(ready.storageKey)).toString()).toBe('keep');
  });

  it('lets concurrent workers clean each document exactly once', async () => {
    const storage = new InMemoryObjectStorage();
    const deletes: string[] = [];
    const original = storage.deleteObject.bind(storage);
    storage.deleteObject = async (key) => {
      deletes.push(key);
      await new Promise((r) => setTimeout(r, 50));
      return original(key);
    };
    const docs = await Promise.all(
      [1, 2, 3].map(() => seedDocument(db, tenant, { status: 'DELETING' })),
    );
    const workers = [1, 2, 3].map(
      () => new DocumentCleanupService(db, storage),
    );

    const results = await Promise.all(workers.map((w) => w.cleanupNext()));

    expect(results.filter(Boolean)).toHaveLength(3);
    expect(new Set(deletes).size).toBe(3);
    for (const doc of docs)
      expect(await statusOf(doc.documentId)).toBe('DELETED');
  });
});
