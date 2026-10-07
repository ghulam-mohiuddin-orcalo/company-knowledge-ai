import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig } from '@cka/config';
import { JsonLogger, runWithContext } from '@cka/observability';
import { ApiMetrics } from './metrics/api-metrics.js';
import type { NextFunction, Request, Response } from 'express';

/** Accept a caller's request ID only if it is a plain token (log-injection safe). */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Largest JSON request body; file uploads use multipart with their own limit. */
export const JSON_BODY_LIMIT = '64kb';

/**
 * HTTP-level settings shared by the real server and the test harness, so tests
 * exercise exactly what production runs.
 */
export function configureApp(
  app: INestApplication,
  config: AppConfig,
  logger: JsonLogger,
): void {
  const express = app as NestExpressApplication;
  const metrics = app.get(ApiMetrics);
  // Client IPs (for rate limits) come from X-Forwarded-For only behind a trusted proxy.
  express.set('trust proxy', config.trustProxy);
  express.disable('x-powered-by');
  express.useBodyParser('json', { limit: JSON_BODY_LIMIT });

  // Correlation: every request gets an ID, echoed in the response, the error
  // envelope and every log line written while handling it (E8-T01).
  express.use((request: Request, response: Response, next: NextFunction) => {
    const incoming = request.header('x-request-id');
    const requestId =
      incoming && REQUEST_ID.test(incoming) ? incoming : `req_${randomUUID()}`;
    response.setHeader('X-Request-Id', requestId);
    // The API only returns JSON or attachments: never render, frame, sniff or
    // cache its (tenant) responses (E8-T04).
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    const started = process.hrtime.bigint();
    runWithContext({ requestId }, () => {
      response.on('finish', () => {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        // Route templates only (bounded cardinality, no IDs); unmatched paths are pooled.
        const route =
          (request.route as { path?: string } | undefined)?.path ?? 'unmatched';
        metrics.recordHttp(request.method, route, response.statusCode, seconds);
        logger.event(
          response.statusCode >= 500 ? 'warn' : 'log',
          'http_request',
          {
            method: request.method,
            // Path only: query strings may carry cursors or other user input.
            path: request.path,
            status: response.statusCode,
            durationMs: Number(
              (process.hrtime.bigint() - started) / 1_000_000n,
            ),
          },
        );
      });
      next();
    });
  });

  // Browser access only from the configured web origins. Bearer tokens, no cookies.
  app.enableCors({
    origin: config.app.corsAllowedOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Organization-Id',
      'X-Request-Id',
    ],
    exposedHeaders: ['Content-Disposition', 'Retry-After', 'X-Request-Id'],
    maxAge: 600,
  });
}
