import { Logger } from '@nestjs/common';
import type { DocumentCleanupService } from './cleanup/document-cleanup.service.js';
import type { IngestionProcessor } from './ingestion/ingestion-processor.js';
import { createTestConfig } from './testing/test-config.js';
import { MAX_FAILURE_BACKOFF_MS, WorkerLoop } from './worker-loop.js';

describe('WorkerLoop failure handling (E8-T06)', () => {
  const config = createTestConfig({ JOB_POLL_INTERVAL_MS: '1000' });
  let outcomes: Array<boolean | Error>;
  let calls: number[];

  const loop = () =>
    new WorkerLoop(
      config,
      {
        cleanupNext: () => Promise.resolve(false),
      } as unknown as DocumentCleanupService,
      {
        processNext: () => {
          calls.push(Date.now());
          const next = outcomes.shift() ?? false;
          return next instanceof Error
            ? Promise.reject(next)
            : Promise.resolve(next);
        },
      } as unknown as IngestionProcessor,
    );

  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    outcomes = [];
    calls = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps running through failures, backing off exponentially, then resumes', async () => {
    const dbDown = Object.assign(new Error('connect ECONNREFUSED'), {
      name: 'DatabaseError',
    });
    outcomes = [dbDown, dbDown, dbDown, dbDown, true, false];
    const worker = loop();

    worker.start();
    await vi.advanceTimersByTimeAsync(20_000);
    await worker.stop();

    // Failures at 0, then +1s, +2s, +4s, +8s; recovery processes a job and
    // polls again immediately (next timer tick), then idles at the poll interval.
    expect(calls.slice(0, 7)).toEqual([
      0, 1000, 3000, 7000, 15000, 15001, 16001,
    ]);
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      'Worker cycle recovered after 4 failed cycles',
    );
    // Logs carry the error class only, never connection strings or messages.
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'Worker cycle failed (1 in a row): DatabaseError',
    );
  });

  it('caps the backoff', () => {
    const worker = loop();
    (worker as unknown as { consecutiveFailures: number }).consecutiveFailures =
      20;

    expect(worker.nextDelay(false)).toBe(MAX_FAILURE_BACKOFF_MS);
  });
});
