import {
  type DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AppConfig, EmbeddingConfig } from '@cka/config';
import { OpenAiCompatibleEmbeddingProvider } from '@cka/ai';
import {
  createDatabase,
  createDatabasePool,
  type DatabasePool,
  describeDatabaseError,
} from '@cka/database';
import { type ObjectStorage, S3ObjectStorage } from '@cka/storage';
import { DocumentCleanupService } from './cleanup/document-cleanup.service.js';
import { cl100kTokenCounter } from './ingestion/chunking/token-counter.js';
import { DocxExtractor } from './ingestion/extraction/docx-extractor.js';
import { PdfExtractor } from './ingestion/extraction/pdf-extractor.js';
import { TextExtractor } from './ingestion/extraction/text-extractor.js';
import { IngestionJobsRepository } from './ingestion/ingestion-jobs.repository.js';
import { IngestionProcessor } from './ingestion/ingestion-processor.js';
import {
  DATABASE,
  DATABASE_POOL,
  EMBEDDING_PROVIDER,
  EXTRACTORS,
  OBJECT_STORAGE,
  TOKEN_COUNTER,
  WORKER_CONFIG,
} from './tokens.js';
import { WorkerLoop } from './worker-loop.js';

export interface WorkerConfig {
  config: AppConfig;
  embedding: EmbeddingConfig;
}

@Module({})
export class WorkerModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: DatabasePool,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  static forRoot({ config, embedding }: WorkerConfig): DynamicModule {
    const logger = new Logger('Database');
    return {
      module: WorkerModule,
      providers: [
        { provide: WORKER_CONFIG, useValue: config },
        {
          provide: DATABASE_POOL,
          useFactory: () =>
            createDatabasePool(config.database.url.reveal(), (error) =>
              logger.warn(
                `Idle connection error ${describeDatabaseError(error)}`,
              ),
            ),
        },
        {
          provide: DATABASE,
          inject: [DATABASE_POOL],
          useFactory: createDatabase,
        },
        {
          provide: OBJECT_STORAGE,
          useFactory: () => new S3ObjectStorage(config.storage),
        },
        {
          provide: EMBEDDING_PROVIDER,
          useFactory: () => new OpenAiCompatibleEmbeddingProvider(embedding),
        },
        {
          provide: EXTRACTORS,
          useFactory: () => [
            new TextExtractor(),
            new PdfExtractor(),
            new DocxExtractor(),
          ],
        },
        { provide: TOKEN_COUNTER, useValue: cl100kTokenCounter },
        DocumentCleanupService,
        IngestionJobsRepository,
        IngestionProcessor,
        WorkerLoop,
      ],
      exports: [WorkerLoop, IngestionProcessor, DocumentCleanupService],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.storage instanceof S3ObjectStorage) this.storage.destroy();
    await this.pool.end();
  }
}
