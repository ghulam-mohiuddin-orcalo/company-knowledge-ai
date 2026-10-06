import {
  DeterministicEmbeddingProvider,
  type EmbeddingProvider,
} from '@cka/ai';
import {
  type Database,
  documentChunks,
  documents,
  EMBEDDING_DIMENSIONS,
  ingestionJobs,
} from '@cka/database';
import { type ObjectStorage, ObjectNotFoundError } from '@cka/storage';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { makeDocx, makePdf } from '@cka/ingestion/fixtures';
import { seedDocument, seedTenant } from '../testing/seed.js';
import { createTestWorkerConfig } from '../testing/test-config.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import { DATABASE, EMBEDDING_PROVIDER, OBJECT_STORAGE } from '../tokens.js';
import { WorkerLoop } from '../worker-loop.js';
import { WorkerModule } from '../worker.module.js';
import { IngestionJobsRepository } from './ingestion-jobs.repository.js';

const TXT = 'text/plain';
const PDF = 'application/pdf';
const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Records which texts each worker embedded (to detect duplicate processing). */
class RecordingProvider implements EmbeddingProvider {
  readonly model = 'deterministic-test';
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly embedded: string[] = [];
  delayMs = 0;
  onEmbed?: () => Promise<void>;
  private readonly fake = new DeterministicEmbeddingProvider(
    EMBEDDING_DIMENSIONS,
  );

  async embedTexts(texts: readonly string[]): Promise<number[][]> {
    this.embedded.push(...texts);
    await this.onEmbed?.();
    await new Promise((r) => setTimeout(r, this.delayMs));
    return this.fake.embedTexts(texts);
  }
  embedQuery(text: string): Promise<number[]> {
    return this.fake.embedQuery(text);
  }
}

interface Worker {
  module: TestingModule;
  loop: WorkerLoop;
  provider: RecordingProvider;
}

/** Ingestion integration scenarios across real worker instances (E3-T08). */
describe('ingestion integration (E3-T08)', () => {
  let testDb: TestDatabase;
  let workers: Worker[];
  let db: Database;
  let storage: ObjectStorage;
  let tenant: { organizationId: string; userId: string };

  const startWorker = async (): Promise<Worker> => {
    const provider = new RecordingProvider();
    const module = await Test.createTestingModule({
      imports: [
        WorkerModule.forRoot(
          createTestWorkerConfig({
            DATABASE_URL: testDb.url,
            CHUNK_SIZE_TOKENS: '60',
            CHUNK_OVERLAP_TOKENS: '10',
          }),
        ),
      ],
    })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(provider)
      .compile();
    return { module, loop: module.get(WorkerLoop), provider };
  };

  const enqueue = async (mimeType: string, content: Buffer) => {
    const seeded = await seedDocument(db, tenant, {
      mimeType,
      sizeBytes: content.length,
      withJob: true,
    });
    await storage.putObject(seeded.storageKey, content, {
      contentType: mimeType,
    });
    return seeded;
  };
  const statuses = async (ids: string[]) =>
    (
      await db
        .select({ id: documents.id, status: documents.status })
        .from(documents)
        .where(inArray(documents.id, ids))
    ).reduce<Record<string, string>>(
      (all, d) => ({ ...all, [d.id]: d.status }),
      {},
    );
  /** Runs worker cycles until no worker has anything left to do. */
  const drain = async (list: Worker[]) => {
    for (;;) {
      const busy = await Promise.all(list.map((w) => w.loop.tick()));
      if (!busy.some(Boolean)) return;
    }
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    workers = [await startWorker(), await startWorker()];
    db = workers[0]!.module.get(DATABASE);
    storage = workers[0]!.module.get(OBJECT_STORAGE);
    tenant = await seedTenant(db);
  });

  afterAll(async () => {
    for (const worker of workers ?? []) await worker.module.close();
    await testDb?.drop();
  });

  beforeEach(() => {
    for (const worker of workers) {
      worker.provider.embedded.length = 0;
      worker.provider.delayMs = 0;
      worker.provider.onEmbed = undefined;
    }
  });

  it('processes valid TXT, PDF and DOCX documents to READY across two workers, each exactly once', async () => {
    const seeded = [
      await enqueue(
        TXT,
        Buffer.from('Remote work is allowed two days a week.'),
      ),
      await enqueue(PDF, makePdf([['Travel must be booked via the portal.']])),
      await enqueue(
        DOCX,
        await makeDocx([
          { heading: 1, text: 'Security' },
          { paragraph: 'Lock your screen when away.' },
        ]),
      ),
      await enqueue(TXT, Buffer.from('Payroll runs on the 25th.')),
      await enqueue(TXT, Buffer.from('Fire drills happen quarterly.')),
      await enqueue(TXT, Buffer.from('Laptops are refreshed every 3 years.')),
    ];
    for (const worker of workers) worker.provider.delayMs = 20;

    await drain(workers);

    const ids = seeded.map((s) => s.documentId);
    expect(Object.values(await statuses(ids))).toEqual(Array(6).fill('READY'));
    // Every chunk embedded exactly once in total: no job ran on both workers.
    const embedded = workers.flatMap((w) => w.provider.embedded);
    expect(embedded).toHaveLength(new Set(embedded).size);
    expect(workers.every((w) => w.provider.embedded.length > 0)).toBe(true);
    const jobs = await db
      .select()
      .from(ingestionJobs)
      .where(inArray(ingestionJobs.documentId, ids));
    expect(jobs.map((j) => [j.status, j.attempt])).toEqual(
      Array(6).fill(['SUCCEEDED', 1]),
    );
    const chunks = await db
      .select({
        documentId: documentChunks.documentId,
        index: documentChunks.chunkIndex,
      })
      .from(documentChunks)
      .where(inArray(documentChunks.documentId, ids));
    expect(new Set(chunks.map((c) => `${c.documentId}:${c.index}`)).size).toBe(
      chunks.length,
    );
  });

  it('fails empty documents safely, without chunks', async () => {
    const empty = await enqueue(TXT, Buffer.from('\n\n   \n'));
    const worker = workers[0]!;
    await drain([worker]);

    expect(await statuses([empty.documentId])).toEqual({
      [empty.documentId]: 'FAILED',
    });
    const [row] = await db
      .select({ errorCode: documents.errorCode })
      .from(documents)
      .where(eq(documents.id, empty.documentId));
    expect(row!.errorCode).toBe('EXTRACTION_EMPTY');
  });

  it('discards work when the document is deleted during processing, then cleans up', async () => {
    const seeded = await enqueue(
      TXT,
      Buffer.from('Confidential plan to be deleted.'),
    );
    const worker = workers[0]!;
    // The admin deletes the document while its embeddings are being generated.
    worker.provider.onEmbed = async () => {
      await db
        .update(documents)
        .set({ status: 'DELETING' })
        .where(eq(documents.id, seeded.documentId));
    };

    await worker.loop.tick();
    expect(await statuses([seeded.documentId])).toEqual({
      [seeded.documentId]: 'DELETING',
    });
    const [job] = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, seeded.jobId!));
    expect(job!.status).toBe('CANCELLED');

    worker.provider.onEmbed = undefined;
    await drain([worker]);

    expect(await statuses([seeded.documentId])).toEqual({
      [seeded.documentId]: 'DELETED',
    });
    expect(
      await db
        .select()
        .from(documentChunks)
        .where(eq(documentChunks.documentId, seeded.documentId)),
    ).toEqual([]);
    await expect(storage.getObject(seeded.storageKey)).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it('recovers a job from a crashed worker exactly once', async () => {
    const seeded = await enqueue(TXT, Buffer.from('Crash recovery content.'));
    const crashedRepository = workers[0]!.module.get(IngestionJobsRepository);
    const crashedClaim = (await crashedRepository.claimNext())!;
    // The worker dies; its lease runs out.
    await db
      .update(ingestionJobs)
      .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(ingestionJobs.id, crashedClaim.jobId));

    await drain([workers[1]!]);
    const lateResult = await crashedRepository.complete(
      crashedClaim,
      [
        {
          chunkIndex: 0,
          content: 'stale',
          tokenCount: 1,
          pageNumber: null,
          sectionPath: null,
          charStart: 0,
          charEnd: 5,
          embedding: Array<number>(EMBEDDING_DIMENSIONS).fill(0),
        },
      ],
      'stale',
    );

    expect(lateResult).toBe('lost');
    expect(await statuses([seeded.documentId])).toEqual({
      [seeded.documentId]: 'READY',
    });
    const chunks = await db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, seeded.documentId));
    expect(chunks.map((c) => c.content)).toEqual(['Crash recovery content.']);
  });
});
