import {
  auditEvents,
  createDatabase,
  createDatabasePool,
  type Database,
  type DatabasePool,
  documentChunks,
  documents,
  EMBEDDING_DIMENSIONS,
  ingestionJobs,
} from '@cka/database';
import { eq, sql } from 'drizzle-orm';
import { seedDocument, seedTenant } from '../testing/seed.js';
import { createTestConfig } from '../testing/test-config.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import {
  IngestionJobsRepository,
  type NewChunk,
} from './ingestion-jobs.repository.js';

const chunk = (chunkIndex: number): NewChunk => ({
  chunkIndex,
  content: `chunk ${chunkIndex}`,
  tokenCount: 2,
  pageNumber: 1,
  sectionPath: null,
  charStart: 0,
  charEnd: 7,
  embedding: Array<number>(EMBEDDING_DIMENSIONS).fill(0.1),
});

describe('database-backed ingestion claim/retry (E3-T06)', () => {
  let testDb: TestDatabase;
  let pool: DatabasePool;
  let db: Database;
  let jobs: IngestionJobsRepository;
  let tenant: { organizationId: string; userId: string };

  const jobRow = async (id: string) =>
    (await db.select().from(ingestionJobs).where(eq(ingestionJobs.id, id)))[0]!;
  const documentRow = async (id: string) =>
    (await db.select().from(documents).where(eq(documents.id, id)))[0]!;
  const chunksOf = async (documentId: string) =>
    db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId));
  const expireLease = (jobId: string) =>
    db
      .update(ingestionJobs)
      .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(ingestionJobs.id, jobId));
  const makeDue = (jobId: string) =>
    db
      .update(ingestionJobs)
      .set({ nextAttemptAt: sql`now() - interval '1 second'` })
      .where(eq(ingestionJobs.id, jobId));
  /** Leaves exactly one runnable job in the queue. */
  const onlyJob = async () => {
    await db
      .update(ingestionJobs)
      .set({ status: 'CANCELLED' })
      .where(sql`${ingestionJobs.status} in ('QUEUED', 'PROCESSING')`);
    return seedDocument(db, tenant, { withJob: true });
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    pool = createDatabasePool(testDb.url);
    db = createDatabase(pool);
    jobs = new IngestionJobsRepository(
      db,
      createTestConfig({
        JOB_MAX_ATTEMPTS: '3',
        JOB_RETRY_BACKOFF_MS: '60000',
      }),
    );
    tenant = await seedTenant(db);
  });

  afterAll(async () => {
    await pool?.end();
    await testDb?.drop();
  });

  it('claims a queued job and moves the document to PROCESSING', async () => {
    const seeded = await onlyJob();

    const claimed = await jobs.claimNext();

    expect(claimed).toMatchObject({
      jobId: seeded.jobId,
      documentId: seeded.documentId,
      organizationId: tenant.organizationId,
      attempt: 1,
      storageKey: seeded.storageKey,
      mimeType: 'text/plain',
    });
    expect(await jobRow(seeded.jobId!)).toMatchObject({
      status: 'PROCESSING',
      attempt: 1,
      claimToken: claimed!.claimToken,
    });
    expect((await documentRow(seeded.documentId)).status).toBe('PROCESSING');
    expect(await jobs.claimNext()).toBeUndefined();
  });

  it('never lets two workers claim the same job', async () => {
    await onlyJob();
    const seeded = await Promise.all(
      [1, 2, 3, 4].map(() => seedDocument(db, tenant, { withJob: true })),
    );
    const workers = Array.from(
      { length: 4 },
      () =>
        new IngestionJobsRepository(
          db,
          createTestConfig({ JOB_MAX_ATTEMPTS: '3' }),
        ),
    );

    const claims = (
      await Promise.all(
        Array.from({ length: 12 }, (_, i) => workers[i % 4]!.claimNext()),
      )
    ).filter((c) => c !== undefined);

    const claimedIds = claims.map((c) => c.jobId);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(new Set(claimedIds)).toEqual(
      new Set([...seeded.map((s) => s.jobId), await onlyJobId()]),
    );
  });

  async function onlyJobId(): Promise<string> {
    const [row] = await db
      .select({ id: ingestionJobs.id })
      .from(ingestionJobs)
      .where(eq(ingestionJobs.status, 'PROCESSING'))
      .orderBy(ingestionJobs.createdAt)
      .limit(1);
    return row!.id;
  }

  it('recovers a crashed worker’s job without duplicating chunks', async () => {
    const seeded = await onlyJob();
    const crashed = (await jobs.claimNext())!;
    await expireLease(crashed.jobId);

    const recovered = (await jobs.claimNext())!;

    expect(recovered.jobId).toBe(crashed.jobId);
    expect(recovered.attempt).toBe(2);
    expect(recovered.claimToken).not.toBe(crashed.claimToken);
    // The stale worker wakes up and tries to finish: it no longer owns the job.
    expect(await jobs.complete(crashed, [chunk(0), chunk(1)], 'm')).toBe(
      'lost',
    );
    expect(await chunksOf(seeded.documentId)).toEqual([]);

    expect(await jobs.complete(recovered, [chunk(0), chunk(1)], 'm')).toBe(
      'succeeded',
    );
    expect(await chunksOf(seeded.documentId)).toHaveLength(2);
    expect((await documentRow(seeded.documentId)).status).toBe('READY');
    expect(await jobs.complete(recovered, [chunk(0)], 'm')).toBe('lost');
    expect(await chunksOf(seeded.documentId)).toHaveLength(2);
  });

  it('does not reclaim a job whose lease is still valid', async () => {
    await onlyJob();
    await jobs.claimNext();

    expect(await jobs.claimNext()).toBeUndefined();
  });

  it('retries retryable failures with backoff, then fails when attempts run out', async () => {
    const seeded = await onlyJob();

    for (let attempt = 1; attempt <= 2; attempt++) {
      const claimed = (await jobs.claimNext())!;
      expect(claimed.attempt).toBe(attempt);
      expect(
        await jobs.fail(claimed, {
          code: 'PROVIDER_UNAVAILABLE',
          retryable: true,
        }),
      ).toBe('retry');
      expect(await jobRow(seeded.jobId!)).toMatchObject({
        status: 'QUEUED',
        errorCode: 'PROVIDER_UNAVAILABLE',
        claimToken: null,
      });
      expect((await documentRow(seeded.documentId)).status).toBe('QUEUED');
      // Backoff: not claimable until due.
      expect(await jobs.claimNext()).toBeUndefined();
      await makeDue(seeded.jobId!);
    }

    const last = (await jobs.claimNext())!;
    expect(last.attempt).toBe(3);
    expect(
      await jobs.fail(last, { code: 'PROVIDER_UNAVAILABLE', retryable: true }),
    ).toBe('failed');
    expect(await jobRow(seeded.jobId!)).toMatchObject({
      status: 'FAILED',
      attempt: 3,
    });
    expect(await documentRow(seeded.documentId)).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('fails non-retryable errors immediately', async () => {
    const seeded = await onlyJob();
    const claimed = (await jobs.claimNext())!;

    expect(
      await jobs.fail(claimed, { code: 'EXTRACTION_EMPTY', retryable: false }),
    ).toBe('failed');
    expect(await documentRow(seeded.documentId)).toMatchObject({
      status: 'FAILED',
      errorCode: 'EXTRACTION_EMPTY',
    });
  });

  it('fails a job whose last attempt crashed', async () => {
    const seeded = await onlyJob();
    await db
      .update(ingestionJobs)
      .set({
        status: 'PROCESSING',
        attempt: 3,
        leaseExpiresAt: sql`now() - interval '1 second'`,
      })
      .where(eq(ingestionJobs.id, seeded.jobId!));

    expect(await jobs.claimNext()).toBeUndefined();
    expect((await jobRow(seeded.jobId!)).status).toBe('FAILED');
    expect(await documentRow(seeded.documentId)).toMatchObject({
      status: 'FAILED',
      errorCode: 'INGESTION_ATTEMPTS_EXHAUSTED',
    });
  });

  it('audits final ingestion outcomes, not scheduled retries (E8-T02)', async () => {
    const audited = async (documentId: string) =>
      (
        await db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.targetId, documentId))
      ).map((e) => [e.action, e.metadata]);

    const ok = await onlyJob();
    const okClaim = (await jobs.claimNext())!;
    await jobs.complete(okClaim, [chunk(0), chunk(1)], 'm');
    expect(await audited(ok.documentId)).toEqual([
      ['INGESTION_SUCCEEDED', { jobId: ok.jobId, attempt: 1, chunkCount: 2 }],
    ]);

    const retried = await onlyJob();
    const retryClaim = (await jobs.claimNext())!;
    await jobs.fail(retryClaim, {
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
    expect(await audited(retried.documentId)).toEqual([]);

    const failed = await onlyJob();
    const failClaim = (await jobs.claimNext())!;
    await jobs.fail(failClaim, { code: 'EXTRACTION_EMPTY', retryable: false });
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, failed.documentId));
    expect(event).toMatchObject({
      action: 'INGESTION_FAILED',
      organizationId: tenant.organizationId,
      actorUserId: null,
      metadata: {
        jobId: failed.jobId,
        attempt: 1,
        errorCode: 'EXTRACTION_EMPTY',
      },
    });
  });

  it('cancels jobs of documents deleted before processing', async () => {
    const seeded = await onlyJob();
    await db
      .update(documents)
      .set({ status: 'DELETING' })
      .where(eq(documents.id, seeded.documentId));

    expect(await jobs.claimNext()).toBeUndefined();
    expect((await jobRow(seeded.jobId!)).status).toBe('CANCELLED');
    expect((await documentRow(seeded.documentId)).status).toBe('DELETING');
  });

  it('discards results when the document is deleted during processing', async () => {
    const seeded = await onlyJob();
    const claimed = (await jobs.claimNext())!;
    await db
      .update(documents)
      .set({ status: 'DELETING' })
      .where(eq(documents.id, seeded.documentId));

    expect(await jobs.complete(claimed, [chunk(0)], 'm')).toBe('cancelled');

    expect(await chunksOf(seeded.documentId)).toEqual([]);
    expect((await documentRow(seeded.documentId)).status).toBe('DELETING');
    expect((await jobRow(seeded.jobId!)).status).toBe('CANCELLED');
  });
});
