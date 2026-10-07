import { Inject, Injectable } from '@nestjs/common';
import { type Database } from '@cka/database';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';

export interface OperationalSnapshot {
  documentsByStatus: Array<{ status: string; count: number }>;
  jobsByStatus: Array<{ status: string; count: number }>;
  oldestQueuedJobAgeSeconds: number;
  /** Jobs finished in the window, by result. */
  ingestionResults: Array<{ result: string; count: number }>;
  ingestionFailures: Array<{ errorCode: string; count: number }>;
  /** Processing time (start to finish) and end-to-end time (upload to finish). */
  ingestionLatency: Array<{ kind: string; quantile: string; seconds: number }>;
  answersByOutcome: Array<{ outcome: string; count: number }>;
  answerLatency: Array<{ quantile: string; seconds: number }>;
  tokens: Array<{ model: string; kind: string; count: number }>;
}

/** Window for rolling operational aggregates. */
export const METRICS_WINDOW = '24 hours';

const num = (value: unknown) => Number(value ?? 0);

/**
 * Platform-wide operational aggregates for /metrics (E8-T05). Deliberately
 * tenant-agnostic: returns counts, durations and codes only — no organization,
 * user or document identifiers and no text. Computed from the database so the
 * numbers are correct across API and worker instances.
 */
@Injectable()
export class OperationalMetricsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async snapshot(): Promise<OperationalSnapshot> {
    const window = sql.raw(`interval '${METRICS_WINDOW}'`);
    const [
      documents,
      jobs,
      backlog,
      results,
      failures,
      latency,
      answers,
      answerLatency,
      tokens,
    ] = await Promise.all([
      this.rows(
        sql`SELECT status::text AS status, count(*) AS count FROM documents GROUP BY status`,
      ),
      this.rows(
        sql`SELECT status::text AS status, count(*) AS count FROM ingestion_jobs GROUP BY status`,
      ),
      this.rows(sql`
          SELECT coalesce(extract(epoch FROM now() - min(created_at)), 0) AS age
          FROM ingestion_jobs WHERE status = 'QUEUED'`),
      this.rows(sql`
          SELECT status::text AS result, count(*) AS count FROM ingestion_jobs
          WHERE status IN ('SUCCEEDED', 'FAILED') AND completed_at > now() - ${window}
          GROUP BY status`),
      this.rows(sql`
          SELECT coalesce(error_code, 'UNKNOWN') AS error_code, count(*) AS count FROM ingestion_jobs
          WHERE status = 'FAILED' AND completed_at > now() - ${window}
          GROUP BY 1`),
      this.rows(sql`
          SELECT
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - started_at)) AS processing_p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - started_at)) AS processing_p95,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - created_at)) AS end_to_end_p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - created_at)) AS end_to_end_p95
          FROM ingestion_jobs
          WHERE status = 'SUCCEEDED' AND completed_at > now() - ${window}`),
      this.rows(sql`
          SELECT outcome::text AS outcome, count(*) AS count FROM messages
          WHERE role = 'ASSISTANT' AND created_at > now() - ${window}
          GROUP BY outcome`),
      this.rows(sql`
          SELECT
            percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) / 1000.0 AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) / 1000.0 AS p95
          FROM messages
          WHERE role = 'ASSISTANT' AND latency_ms IS NOT NULL AND created_at > now() - ${window}`),
      this.rows(sql`
          SELECT model, sum(input_tokens) AS input, sum(output_tokens) AS output FROM messages
          WHERE role = 'ASSISTANT' AND model IS NOT NULL AND created_at > now() - ${window}
          GROUP BY model`),
    ]);

    const [l] = latency;
    const [a] = answerLatency;
    return {
      documentsByStatus: documents.map((r) => ({
        status: String(r.status),
        count: num(r.count),
      })),
      jobsByStatus: jobs.map((r) => ({
        status: String(r.status),
        count: num(r.count),
      })),
      oldestQueuedJobAgeSeconds: num(backlog[0]?.age),
      ingestionResults: results.map((r) => ({
        result: String(r.result),
        count: num(r.count),
      })),
      ingestionFailures: failures.map((r) => ({
        errorCode: String(r.error_code),
        count: num(r.count),
      })),
      ingestionLatency: [
        {
          kind: 'processing',
          quantile: '0.5',
          seconds: num(l?.processing_p50),
        },
        {
          kind: 'processing',
          quantile: '0.95',
          seconds: num(l?.processing_p95),
        },
        {
          kind: 'end_to_end',
          quantile: '0.5',
          seconds: num(l?.end_to_end_p50),
        },
        {
          kind: 'end_to_end',
          quantile: '0.95',
          seconds: num(l?.end_to_end_p95),
        },
      ],
      answersByOutcome: answers.map((r) => ({
        outcome: String(r.outcome),
        count: num(r.count),
      })),
      answerLatency: [
        { quantile: '0.5', seconds: num(a?.p50) },
        { quantile: '0.95', seconds: num(a?.p95) },
      ],
      tokens: tokens.flatMap((r) => [
        { model: String(r.model), kind: 'input', count: num(r.input) },
        { model: String(r.model), kind: 'output', count: num(r.output) },
      ]),
    };
  }

  private async rows(
    query: ReturnType<typeof sql>,
  ): Promise<Array<Record<string, unknown>>> {
    const result = await this.db.execute(query);
    return result.rows as Array<Record<string, unknown>>;
  }
}
