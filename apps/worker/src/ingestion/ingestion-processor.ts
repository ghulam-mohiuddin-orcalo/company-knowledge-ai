import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { runWithContext } from '@cka/observability';
import type { AppConfig } from '@cka/config';
import { type EmbeddingProvider, EmbeddingProviderError } from '@cka/ai';
import {
  documentObjectKey,
  ObjectNotFoundError,
  type ObjectStorage,
  ObjectStorageError,
} from '@cka/storage';
import {
  EMBEDDING_PROVIDER,
  EXTRACTORS,
  OBJECT_STORAGE,
  TOKEN_COUNTER,
  WORKER_CONFIG,
} from '../tokens.js';
import {
  chunkSegments,
  type DocumentExtractor,
  extractDocument,
  ExtractionError,
  type TokenCounter,
} from '@cka/ingestion';
import {
  type ClaimedJob,
  IngestionJobsRepository,
  type JobFailure,
} from './ingestion-jobs.repository.js';

class StorageKeyMismatchError extends Error {}

/**
 * Ingestion pipeline (TDD §12): storage read -> extraction -> normalization ->
 * chunking -> embeddings -> atomic vector persistence -> READY. Logs carry
 * identifiers and counts only, never document text.
 */
@Injectable()
export class IngestionProcessor {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly jobs: IngestionJobsRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(EXTRACTORS) private readonly extractors: DocumentExtractor[],
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: TokenCounter,
    @Inject(WORKER_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Claims and processes one job. Returns false when the queue is idle. */
  async processNext(): Promise<boolean> {
    const job = await this.jobs.claimNext();
    if (!job) return false;
    // Every log line for this job carries its correlation IDs (E8-T01).
    await runWithContext(
      {
        jobId: job.jobId,
        organizationId: job.organizationId,
        documentId: job.documentId,
      },
      () => this.process(job),
    );
    return true;
  }

  private async process(job: ClaimedJob): Promise<void> {
    const started = performance.now();
    const context = `job ${job.jobId} document ${job.documentId} org ${job.organizationId} attempt ${job.attempt}`;
    const lease = this.keepLeaseAlive(job);
    try {
      const chunkCount = await this.ingest(job, lease);
      const outcome = chunkCount === undefined ? 'cancelled' : 'succeeded';
      this.logger.log(
        `Ingestion ${outcome}: ${context} chunks ${chunkCount ?? 0} durationMs ${Math.round(performance.now() - started)}`,
      );
    } catch (error) {
      if (error instanceof ClaimLostError) {
        // Another worker owns the job now; it alone may finish it.
        this.logger.warn(`Ingestion abandoned (claim lost): ${context}`);
        return;
      }
      const failure = classify(error);
      const outcome = await this.jobs.fail(job, failure);
      const log = `Ingestion ${outcome}: ${context} code ${failure.code} durationMs ${Math.round(performance.now() - started)}`;
      if (outcome === 'failed') this.logger.warn(log);
      else this.logger.log(log);
    } finally {
      lease.stop();
    }
  }

  /**
   * Renews the job's lease every third of its duration while it is processed.
   * Renewal errors (e.g. a brief database outage) are retried at the next beat;
   * if the lease still expires, the claim token keeps a reclaimed job from
   * being completed twice.
   */
  private keepLeaseAlive(job: ClaimedJob): Lease {
    let lost = false;
    const timer = setInterval(
      () => {
        this.jobs.renewLease(job).then(
          (renewed) => {
            if (!renewed && !lost) {
              lost = true;
              this.logger.warn(`Ingestion lease lost: job ${job.jobId}`);
            }
          },
          (error: unknown) =>
            this.logger.warn(
              `Lease renewal failed: job ${job.jobId} ${error instanceof Error ? error.name : 'unknown error'}`,
            ),
        );
      },
      Math.max(50, Math.floor(this.config.jobs.leaseMs / 3)),
    );
    timer.unref();
    return {
      get lost() {
        return lost;
      },
      stop: () => clearInterval(timer),
    };
  }

  /** Returns the persisted chunk count, or undefined when the result was discarded. */
  private async ingest(
    job: ClaimedJob,
    lease: Lease,
  ): Promise<number | undefined> {
    // Defense in depth: only read the object this tenant's document owns.
    if (
      job.storageKey !== documentObjectKey(job.organizationId, job.documentId)
    ) {
      throw new StorageKeyMismatchError();
    }
    const content = await this.storage.getObject(job.storageKey);
    const segments = await extractDocument(
      this.extractors,
      job.mimeType,
      content,
    );
    const chunks = chunkSegments(
      segments,
      this.config.chunking,
      this.tokenCounter,
    );
    // Skip the costly provider call if another worker has taken over.
    if (lease.lost) throw new ClaimLostError();
    const vectors = await this.embeddings.embedTexts(
      chunks.map((c) => c.content),
    );

    const outcome = await this.jobs.complete(
      job,
      chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i]! })),
      this.embeddings.model,
    );
    return outcome === 'succeeded' ? chunks.length : undefined;
  }
}

interface Lease {
  readonly lost: boolean;
  stop(): void;
}

/** The job's lease was lost to another worker mid-processing. */
class ClaimLostError extends Error {
  override readonly name = 'ClaimLostError';
}

/** Maps pipeline errors to safe codes; transient failures are retried. */
export function classify(error: unknown): JobFailure {
  if (error instanceof ExtractionError) {
    return { code: error.code, retryable: false };
  }
  if (error instanceof EmbeddingProviderError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof ObjectNotFoundError) {
    return { code: 'STORAGE_OBJECT_MISSING', retryable: false };
  }
  if (error instanceof ObjectStorageError) {
    return { code: 'STORAGE_UNAVAILABLE', retryable: true };
  }
  if (error instanceof StorageKeyMismatchError) {
    return { code: 'STORAGE_KEY_MISMATCH', retryable: false };
  }
  return { code: 'INGESTION_INTERNAL_ERROR', retryable: true };
}
