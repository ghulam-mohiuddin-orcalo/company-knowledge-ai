import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@cka/config';
import {
  type Database,
  documentChunks,
  documents,
  ingestionJobs,
} from '@cka/database';
import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { DATABASE, WORKER_CONFIG } from '../tokens.js';

/** A job this worker currently owns. Every write is conditioned on `claimToken`. */
export interface ClaimedJob {
  jobId: string;
  organizationId: string;
  documentId: string;
  attempt: number;
  claimToken: string;
  storageKey: string;
  mimeType: string;
}

export interface NewChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageNumber: number | null;
  sectionPath: string | null;
  charStart: number;
  charEnd: number;
  embedding: number[];
}

export interface JobFailure {
  code: string;
  retryable: boolean;
}

/** Outcome of finishing a job; `lost` means another worker reclaimed it. */
export type FinishOutcome =
  'succeeded' | 'retry' | 'failed' | 'cancelled' | 'lost';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Database-backed ingestion queue (TDD §21): claims with FOR UPDATE SKIP LOCKED,
 * leases for crash recovery, claim tokens so only the current owner can finish
 * a job, bounded retries with exponential backoff. All queries are scoped by the
 * job's own organization_id and document_id (server-held data).
 */
@Injectable()
export class IngestionJobsRepository {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WORKER_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Claims the next runnable job: QUEUED and due, or PROCESSING with an expired
   * lease (a crashed worker). Jobs whose document is no longer ingestible are
   * cancelled; jobs out of attempts are failed. Returns undefined when idle.
   */
  async claimNext(): Promise<ClaimedJob | undefined> {
    for (;;) {
      const result = await this.db.transaction((tx) => this.claimOne(tx));
      if (result !== 'skipped') return result;
    }
  }

  private async claimOne(tx: Tx): Promise<ClaimedJob | undefined | 'skipped'> {
    const now = sql`now()`;
    const [job] = await tx
      .select({
        id: ingestionJobs.id,
        organizationId: ingestionJobs.organizationId,
        documentId: ingestionJobs.documentId,
        attempt: ingestionJobs.attempt,
      })
      .from(ingestionJobs)
      .where(
        or(
          and(
            eq(ingestionJobs.status, 'QUEUED'),
            lte(ingestionJobs.nextAttemptAt, now),
          ),
          and(
            eq(ingestionJobs.status, 'PROCESSING'),
            lt(ingestionJobs.leaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(ingestionJobs.nextAttemptAt), asc(ingestionJobs.createdAt))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!job) return undefined;

    const [document] = await tx
      .select({
        status: documents.status,
        storageKey: documents.storageKey,
        mimeType: documents.mimeType,
      })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, job.organizationId),
          eq(documents.id, job.documentId),
        ),
      )
      .for('update');

    if (!document || !['QUEUED', 'PROCESSING'].includes(document.status)) {
      await this.setJob(tx, job.id, {
        status: 'CANCELLED',
        completedAt: new Date(),
        claimToken: null,
        leaseExpiresAt: null,
      });
      return 'skipped';
    }
    if (job.attempt >= this.config.jobs.maxAttempts) {
      // The final attempt's worker died without finishing.
      await this.setJob(tx, job.id, {
        status: 'FAILED',
        completedAt: new Date(),
        claimToken: null,
        leaseExpiresAt: null,
        errorCode: 'INGESTION_ATTEMPTS_EXHAUSTED',
      });
      await this.setDocument(tx, job, 'FAILED', 'INGESTION_ATTEMPTS_EXHAUSTED');
      return 'skipped';
    }

    const claimToken = randomUUID();
    await this.setJob(tx, job.id, {
      status: 'PROCESSING',
      attempt: job.attempt + 1,
      claimToken,
      leaseExpiresAt: sql`now() + ${this.config.jobs.leaseMs} * interval '1 millisecond'`,
      startedAt: new Date(),
    });
    await this.setDocument(tx, job, 'PROCESSING', null);
    return {
      jobId: job.id,
      organizationId: job.organizationId,
      documentId: job.documentId,
      attempt: job.attempt + 1,
      claimToken,
      storageKey: document.storageKey,
      mimeType: document.mimeType,
    };
  }

  /**
   * Atomically replaces the document's chunks and marks it READY. Chunks become
   * visible only together with READY, so a partial index is never searchable.
   */
  async complete(
    job: ClaimedJob,
    chunks: readonly NewChunk[],
    embeddingModel: string,
  ): Promise<FinishOutcome> {
    return this.db.transaction(async (tx) => {
      const ownership = await this.lockOwned(tx, job);
      if (ownership !== 'owned') return ownership;

      await tx
        .delete(documentChunks)
        .where(
          and(
            eq(documentChunks.organizationId, job.organizationId),
            eq(documentChunks.documentId, job.documentId),
          ),
        );
      for (let i = 0; i < chunks.length; i += 200) {
        await tx.insert(documentChunks).values(
          chunks.slice(i, i + 200).map((chunk) => ({
            ...chunk,
            organizationId: job.organizationId,
            documentId: job.documentId,
            ingestionJobId: job.jobId,
            embeddingModel,
          })),
        );
      }
      await this.setDocument(tx, job, 'READY', null);
      await this.setJob(tx, job.jobId, {
        status: 'SUCCEEDED',
        completedAt: new Date(),
        claimToken: null,
        leaseExpiresAt: null,
        errorCode: null,
        errorDetailSafe: null,
      });
      return 'succeeded';
    });
  }

  /** Requeues with backoff (retryable, attempts left) or fails the job and document. */
  async fail(job: ClaimedJob, failure: JobFailure): Promise<FinishOutcome> {
    return this.db.transaction(async (tx) => {
      const ownership = await this.lockOwned(tx, job);
      if (ownership !== 'owned') return ownership;

      if (failure.retryable && job.attempt < this.config.jobs.maxAttempts) {
        const delayMs =
          this.config.jobs.retryBackoffMs * 2 ** (job.attempt - 1);
        await this.setJob(tx, job.jobId, {
          status: 'QUEUED',
          nextAttemptAt: sql`now() + ${delayMs} * interval '1 millisecond'`,
          claimToken: null,
          leaseExpiresAt: null,
          errorCode: failure.code,
        });
        await this.setDocument(tx, job, 'QUEUED', null);
        return 'retry';
      }
      await this.setJob(tx, job.jobId, {
        status: 'FAILED',
        completedAt: new Date(),
        claimToken: null,
        leaseExpiresAt: null,
        errorCode: failure.code,
      });
      await this.setDocument(tx, job, 'FAILED', failure.code);
      return 'failed';
    });
  }

  /**
   * Locks the job (must still be ours) and the document (must still be
   * PROCESSING). A document deleted meanwhile cancels the job.
   */
  private async lockOwned(
    tx: Tx,
    job: ClaimedJob,
  ): Promise<'owned' | 'lost' | 'cancelled'> {
    const [owned] = await tx
      .select({ id: ingestionJobs.id })
      .from(ingestionJobs)
      .where(
        and(
          eq(ingestionJobs.organizationId, job.organizationId),
          eq(ingestionJobs.id, job.jobId),
          eq(ingestionJobs.status, 'PROCESSING'),
          eq(ingestionJobs.claimToken, job.claimToken),
        ),
      )
      .for('update');
    if (!owned) return 'lost';

    const [document] = await tx
      .select({ status: documents.status })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, job.organizationId),
          eq(documents.id, job.documentId),
        ),
      )
      .for('update');
    if (document?.status !== 'PROCESSING') {
      await this.setJob(tx, job.jobId, {
        status: 'CANCELLED',
        completedAt: new Date(),
        claimToken: null,
        leaseExpiresAt: null,
      });
      return 'cancelled';
    }
    return 'owned';
  }

  private async setJob(
    tx: Tx,
    jobId: string,
    values: PgUpdateSetSource<typeof ingestionJobs>,
  ): Promise<void> {
    await tx
      .update(ingestionJobs)
      .set(values)
      .where(eq(ingestionJobs.id, jobId));
  }

  /** Lifecycle transition; never resurrects a document that is being deleted. */
  private async setDocument(
    tx: Tx,
    job: { organizationId: string; documentId: string },
    status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED',
    errorCode: string | null,
  ): Promise<void> {
    await tx
      .update(documents)
      .set({ status, errorCode })
      .where(
        and(
          eq(documents.organizationId, job.organizationId),
          eq(documents.id, job.documentId),
          inArray(documents.status, ['QUEUED', 'PROCESSING']),
        ),
      );
  }
}
