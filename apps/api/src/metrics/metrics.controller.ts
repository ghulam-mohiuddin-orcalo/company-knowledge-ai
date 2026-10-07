import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Inject, Logger, Req, Res } from '@nestjs/common';
import type { AppConfig } from '@cka/config';
import { MetricsRegistry, PROMETHEUS_CONTENT_TYPE } from '@cka/observability';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorators.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { ApiMetrics } from './api-metrics.js';
import {
  type OperationalSnapshot,
  OperationalMetricsRepository,
} from './operational-metrics.repository.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Prometheus scrape endpoint (E8-T05). Not a user API: it is disabled (404)
 * unless METRICS_TOKEN is configured, and then requires that bearer token.
 * Failed attempts count toward the per-IP authentication-failure limit.
 */
@Public()
@SkipRateLimit()
@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly metrics: ApiMetrics,
    private readonly operational: OperationalMetricsRepository,
    private readonly limits: RateLimitService,
  ) {}

  @Get()
  async scrape(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.authorize(request);
    const snapshot = await this.operational
      .snapshot()
      .catch((error: unknown) => {
        this.logger.warn(
          `Operational metrics unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        return undefined;
      });
    response
      .status(200)
      .type(PROMETHEUS_CONTENT_TYPE)
      .send(this.metrics.registry.render() + renderSnapshot(snapshot));
  }

  private authorize(request: Request): void {
    const expected = this.config.metricsToken;
    if (!expected) throw ApiError.notFound();
    const ip = request.ip ?? 'unknown';
    this.limits.assertAuthAllowed(ip);
    const presented = /^Bearer (.+)$/.exec(
      request.header('authorization') ?? '',
    )?.[1];
    // Compare fixed-length digests so timing reveals nothing about the token.
    if (
      !presented ||
      !timingSafeEqual(digest(presented), digest(expected.reveal()))
    ) {
      this.limits.recordAuthFailure(ip);
      throw ApiError.unauthenticated();
    }
  }
}

/** Database-derived, platform-wide gauges; `cka_metrics_database_up` reports their availability. */
function renderSnapshot(snapshot: OperationalSnapshot | undefined): string {
  const registry = new MetricsRegistry();
  registry
    .gauge(
      'cka_metrics_database_up',
      'Whether database-derived metrics could be computed.',
    )
    .set({}, snapshot ? 1 : 0);
  if (!snapshot) return registry.render();

  const documents = registry.gauge(
    'cka_documents',
    'Documents by lifecycle status.',
    ['status'],
  );
  snapshot.documentsByStatus.forEach((r) =>
    documents.set({ status: r.status }, r.count),
  );
  const jobs = registry.gauge(
    'cka_ingestion_jobs',
    'Ingestion jobs by status.',
    ['status'],
  );
  snapshot.jobsByStatus.forEach((r) => jobs.set({ status: r.status }, r.count));
  registry
    .gauge(
      'cka_ingestion_queue_oldest_age_seconds',
      'Age of the oldest queued ingestion job.',
    )
    .set({}, snapshot.oldestQueuedJobAgeSeconds);
  const finished = registry.gauge(
    'cka_ingestion_jobs_finished_24h',
    'Ingestion jobs finished in the last 24 hours, by result.',
    ['result'],
  );
  snapshot.ingestionResults.forEach((r) =>
    finished.set({ result: r.result }, r.count),
  );
  const failures = registry.gauge(
    'cka_ingestion_failures_24h',
    'Ingestion failures in the last 24 hours, by classified error code.',
    ['error_code'],
  );
  snapshot.ingestionFailures.forEach((r) =>
    failures.set({ error_code: r.errorCode }, r.count),
  );
  const ingestionLatency = registry.gauge(
    'cka_ingestion_duration_seconds_24h',
    'Ingestion latency quantiles (last 24 hours): processing and upload-to-ready.',
    ['kind', 'quantile'],
  );
  snapshot.ingestionLatency.forEach((r) =>
    ingestionLatency.set({ kind: r.kind, quantile: r.quantile }, r.seconds),
  );
  const answers = registry.gauge(
    'cka_answers_24h',
    'Assistant replies in the last 24 hours, by outcome.',
    ['outcome'],
  );
  snapshot.answersByOutcome.forEach((r) =>
    answers.set({ outcome: r.outcome }, r.count),
  );
  const total = snapshot.answersByOutcome.reduce((sum, r) => sum + r.count, 0);
  const noAnswer =
    snapshot.answersByOutcome.find((r) => r.outcome === 'NO_ANSWER')?.count ??
    0;
  registry
    .gauge(
      'cka_no_answer_ratio_24h',
      'Share of replies in the last 24 hours that were no-answer.',
    )
    .set({}, total === 0 ? 0 : noAnswer / total);
  const answerLatency = registry.gauge(
    'cka_answer_latency_seconds_24h',
    'Question-to-reply latency quantiles (last 24 hours).',
    ['quantile'],
  );
  snapshot.answerLatency.forEach((r) =>
    answerLatency.set({ quantile: r.quantile }, r.seconds),
  );
  const tokens = registry.gauge(
    'cka_generation_tokens_24h',
    'Generation provider tokens used in the last 24 hours, by model and kind.',
    ['model', 'kind'],
  );
  snapshot.tokens.forEach((r) =>
    tokens.set({ model: r.model, kind: r.kind }, r.count),
  );
  return registry.render();
}
