import {
  DeterministicEmbeddingProvider,
  type EmbeddingProvider,
  EmbeddingProviderError,
} from '@cka/ai';
import {
  createDatabase,
  createDatabasePool,
  type Database,
  type DatabasePool,
  documents,
  EMBEDDING_DIMENSIONS,
  ingestionJobs,
} from '@cka/database';
import {
  type DatabaseOutageProxy,
  ingestionInvariantViolations,
  startDatabaseOutageProxy,
} from '@cka/database/testing';
import { type ObjectStorage } from '@cka/storage';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { seedDocument, seedTenant } from '../testing/seed.js';
import { createTestWorkerConfig } from '../testing/test-config.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import { EMBEDDING_PROVIDER, OBJECT_STORAGE } from '../tokens.js';
import { WorkerLoop } from '../worker-loop.js';
import { WorkerModule } from '../worker.module.js';
import { IngestionJobsRepository } from './ingestion-jobs.repository.js';

const TXT = 'text/plain';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Embeds deterministically; records calls; can be slowed or made to fail. */
class ControllableProvider implements EmbeddingProvider {
  readonly model = 'deterministic-test';
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly calls: string[][] = [];
  delayMs = 0;
  failWith: (() => Error | undefined) | undefined;
  onEmbed: (() => void) | undefined;
  private readonly fake = new DeterministicEmbeddingProvider(
    EMBEDDING_DIMENSIONS,
  );

  async embedTexts(texts: readonly string[]): Promise<number[][]> {
    this.calls.push([...texts]);
    this.onEmbed?.();
    await sleep(this.delayMs);
    const error = this.failWith?.();
    if (error) throw error;
    return this.fake.embedTexts(texts);
  }
  embedQuery(text: string): Promise<number[]> {
    return this.fake.embedQuery(text);
  }
}

interface Worker {
  module: TestingModule;
  loop: WorkerLoop;
  jobs: IngestionJobsRepository;
  provider: ControllableProvider;
}

/** Seeded pseudo-random numbers, so fault schedules are reproducible. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('failure and recovery hardening (E8-T06)', () => {
  let testDb: TestDatabase;
  let proxy: DatabaseOutageProxy;
  let pool: DatabasePool;
  let db: Database;
  let storage: ObjectStorage;
  let tenant: { organizationId: string; userId: string };
  const modules: TestingModule[] = [];

  const startWorker = async (
    env: NodeJS.ProcessEnv = {},
    databaseUrl = testDb.url,
  ): Promise<Worker> => {
    const provider = new ControllableProvider();
    const module = await Test.createTestingModule({
      imports: [
        WorkerModule.forRoot(
          createTestWorkerConfig({
            DATABASE_URL: databaseUrl,
            JOB_RETRY_BACKOFF_MS: '1',
            ...env,
          }),
        ),
      ],
    })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(provider)
      .compile();
    modules.push(module);
    return {
      module,
      loop: module.get(WorkerLoop),
      jobs: module.get(IngestionJobsRepository),
      provider,
    };
  };
  const enqueue = async (text: string) => {
    const content = Buffer.from(text);
    const seeded = await seedDocument(db, tenant, {
      mimeType: TXT,
      sizeBytes: content.length,
      withJob: true,
    });
    await storage.putObject(seeded.storageKey, content, { contentType: TXT });
    return seeded;
  };
  const statusOf = async (documentId: string) =>
    (
      await db
        .select({ status: documents.status })
        .from(documents)
        .where(eq(documents.id, documentId))
    )[0]?.status;
  const jobsOf = (documentId: string) =>
    db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.documentId, documentId));
  const drain = async (list: Worker[], rounds = 200) => {
    for (let i = 0; i < rounds; i++) {
      const busy = await Promise.all(list.map((w) => w.loop.tick()));
      if (!busy.some(Boolean)) return;
    }
    throw new Error('queue did not drain');
  };
  const expectConsistent = async () =>
    expect(await ingestionInvariantViolations(testDb.url)).toEqual([]);

  beforeAll(async () => {
    testDb = await createTestDatabase();
    proxy = await startDatabaseOutageProxy(testDb.url);
    pool = createDatabasePool(testDb.url);
    db = createDatabase(pool);
    const first = await startWorker();
    storage = first.module.get(OBJECT_STORAGE);
    tenant = await seedTenant(db);
  });

  afterAll(async () => {
    for (const module of modules) await module.close();
    await pool?.end();
    await proxy?.close();
    await testDb?.drop();
  });

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    proxy.restore();
    // Leave nothing runnable for the next scenario.
    await db
      .update(ingestionJobs)
      .set({ status: 'CANCELLED', claimToken: null, leaseExpiresAt: null })
      .where(inArray(ingestionJobs.status, ['QUEUED', 'PROCESSING']));
    await db
      .update(documents)
      .set({ status: 'FAILED', errorCode: 'TEST_RESET' })
      .where(inArray(documents.status, ['QUEUED', 'PROCESSING']));
  });

  it('renews the lease of a long job so it is never processed twice', async () => {
    const env = { JOB_LEASE_MS: '300' };
    const slow = await startWorker(env);
    const other = await startWorker(env);
    slow.provider.delayMs = 1200;
    const seeded = await enqueue('A long running ingestion job.');

    const processing = slow.loop.tick();
    // Meanwhile another worker keeps polling, well past the original lease.
    let stolen = false;
    for (let i = 0; i < 10; i++) {
      await sleep(120);
      stolen ||= await other.loop.tick();
    }
    await processing;

    expect(stolen).toBe(false);
    expect(slow.provider.calls).toHaveLength(1);
    expect(other.provider.calls).toHaveLength(0);
    expect(await statusOf(seeded.documentId)).toBe('READY');
    expect((await jobsOf(seeded.documentId))[0]).toMatchObject({
      status: 'SUCCEEDED',
      attempt: 1,
    });
    await expectConsistent();
  });

  it('abandons a job whose claim was lost before calling the provider', async () => {
    const env = { JOB_LEASE_MS: '150' };
    const stale = await startWorker(env);
    const successor = await startWorker(env);
    const seeded = await enqueue('Content claimed by two workers.');
    // The stale worker stalls reading storage; meanwhile its claim is lost.
    const storageOf = stale.module.get<ObjectStorage>(OBJECT_STORAGE);
    const read = storageOf.getObject.bind(storageOf);
    vi.spyOn(storageOf, 'getObject').mockImplementation(async (key) => {
      await db
        .update(ingestionJobs)
        .set({
          claimToken: null,
          leaseExpiresAt: sql`now() - interval '1 second'`,
        })
        .where(eq(ingestionJobs.documentId, seeded.documentId));
      await sleep(300);
      return read(key);
    });

    await stale.loop.tick();
    await drain([successor]);

    expect(stale.provider.calls).toHaveLength(0);
    expect(successor.provider.calls).toHaveLength(1);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^Ingestion abandoned \(claim lost\): job /),
    );
    expect(await statusOf(seeded.documentId)).toBe('READY');
    await expectConsistent();
  });

  it('survives a database outage mid-job and completes it exactly once afterwards', async () => {
    const env = { JOB_LEASE_MS: '400' };
    const worker = await startWorker(env, proxy.url);
    const seeded = await enqueue('Survives a database outage.');
    // The database goes away while embeddings are being generated.
    worker.provider.onEmbed = () => proxy.outage();
    const embedding = worker.loop.tick();

    // Neither completing nor recording the failure is possible: the cycle
    // fails, but the worker process keeps running.
    await expect(embedding).rejects.toThrow();
    await expect(worker.loop.tick()).rejects.toThrow();
    expect(await statusOf(seeded.documentId)).toBe('PROCESSING');
    // Nothing half-written is searchable during the outage.
    await expectConsistent();

    proxy.restore();
    worker.provider.onEmbed = undefined;
    await sleep(450); // the orphaned lease expires
    await drain([worker]);

    expect(await statusOf(seeded.documentId)).toBe('READY');
    const jobs = await jobsOf(seeded.documentId);
    expect(jobs).toEqual([
      expect.objectContaining({ status: 'SUCCEEDED', attempt: 2 }),
    ]);
    await expectConsistent();
  });

  it('keeps every invariant under random provider failures, crashes and deletions', async () => {
    const env = { JOB_LEASE_MS: '200', JOB_MAX_ATTEMPTS: '4' };
    const workers = [
      await startWorker(env),
      await startWorker(env),
      await startWorker(env),
    ];
    const next = random(20261006);
    for (const worker of workers) {
      worker.provider.failWith = () =>
        next() < 0.3
          ? new EmbeddingProviderError('PROVIDER_UNAVAILABLE', 503)
          : undefined;
    }
    const seeded = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        enqueue(`Fault injection document number ${i}. It has content.`),
      ),
    );
    const deleted = new Set<string>();

    for (let round = 0; round < 60; round++) {
      const roll = next();
      if (roll < 0.15) {
        // A worker crashes right after claiming: its lease must expire.
        await workers[round % 3]!.jobs.claimNext();
      } else if (roll < 0.25) {
        // An admin deletes a random document, whatever its state.
        const victim = seeded[Math.floor(next() * seeded.length)]!;
        if (deleted.has(victim.documentId)) continue;
        await db
          .update(documents)
          .set({ status: 'DELETING' })
          .where(eq(documents.id, victim.documentId));
        deleted.add(victim.documentId);
      }
      await Promise.all(workers.map((w) => w.loop.tick()));
      await expectConsistent();
      if (round % 10 === 9) await sleep(220); // let crashed leases expire
    }
    for (const worker of workers) worker.provider.failWith = undefined;
    await sleep(220);
    await drain(workers);

    await expectConsistent();
    for (const { documentId } of seeded) {
      const status = await statusOf(documentId);
      if (deleted.has(documentId)) expect(status).toBe('DELETED');
      else expect(['READY', 'FAILED']).toContain(status);
    }
  });
});
