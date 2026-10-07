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
/** Longest pause between cycles while a dependency (e.g. the database) is down. */
export const MAX_FAILURE_BACKOFF_MS = 30_000;

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
  private consecutiveFailures = 0;

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

  /**
   * Busy: poll again immediately. Idle: the poll interval. Failing: back off
   * exponentially (capped) so an outage does not become a tight error loop;
   * the process keeps running and resumes once the dependency is back (E8-T06).
   */
  nextDelay(busy: boolean): number {
    const poll = this.config.jobs.pollIntervalMs;
    if (this.consecutiveFailures > 0) {
      return Math.min(
        poll * 2 ** (this.consecutiveFailures - 1),
        Math.max(poll, MAX_FAILURE_BACKOFF_MS),
      );
    }
    return busy ? 0 : poll;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      let busy = false;
      this.current = this.tick()
        .then((processed) => {
          busy = processed;
          if (this.consecutiveFailures > 0) {
            this.logger.log(
              `Worker cycle recovered after ${this.consecutiveFailures} failed cycles`,
            );
            this.consecutiveFailures = 0;
          }
        })
        .catch((error: unknown) => {
          this.consecutiveFailures++;
          this.logger.error(
            `Worker cycle failed (${this.consecutiveFailures} in a row): ${error instanceof Error ? error.name : 'unknown error'}`,
          );
        })
        .finally(() => {
          if (this.running) this.schedule(this.nextDelay(busy));
        });
    }, delayMs);
  }
}
