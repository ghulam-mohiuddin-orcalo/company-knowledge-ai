import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AppConfig } from '@cka/config';
import { DocumentCleanupService } from './cleanup/document-cleanup.service.js';
import { IngestionProcessor } from './ingestion/ingestion-processor.js';
import { WORKER_CONFIG } from './tokens.js';

const MAX_CLEANUPS_PER_TICK = 10;

/**
 * Database-polling loop (no broker, TDD §21). One unit of work at a time per
 * worker; scale out by running more worker processes.
 */
@Injectable()
export class WorkerLoop implements OnApplicationShutdown {
  private readonly logger = new Logger(WorkerLoop.name);
  private running = false;
  private current: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: AppConfig,
    private readonly cleanup: DocumentCleanupService,
    private readonly ingestion: IngestionProcessor,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  /** Stops polling and waits for in-flight work to finish. */
  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await this.current;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  /**
   * Runs one polling cycle: pending deletion cleanups, then one ingestion job.
   * Returns true when a job was processed (poll again immediately).
   */
  async tick(): Promise<boolean> {
    for (let i = 0; i < MAX_CLEANUPS_PER_TICK; i++) {
      if (!(await this.cleanup.cleanupNext())) break;
    }
    return this.ingestion.processNext();
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      let busy = false;
      this.current = this.tick()
        .then((processed) => {
          busy = processed;
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Worker cycle failed: ${error instanceof Error ? error.name : 'unknown error'}`,
          );
        })
        .finally(() => {
          if (this.running) {
            this.schedule(busy ? 0 : this.config.jobs.pollIntervalMs);
          }
        });
    }, delayMs);
  }
}
