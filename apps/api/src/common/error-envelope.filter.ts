import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  describeDatabaseError,
  isDatabaseUnavailableError,
} from '@cka/database';
import { getLogContext } from '@cka/observability';
import type { Response } from 'express';
import { ApiError, type ApiErrorCode } from './api-error.js';
import type { ErrorEnvelope } from '@cka/contracts';
export type { ErrorEnvelope };

const DATABASE_RETRY_AFTER_SECONDS = 5;

const HTTP_STATUS_CODES: Partial<Record<number, [ApiErrorCode, string]>> = {
  [HttpStatus.BAD_REQUEST]: ['VALIDATION_FAILED', 'The request is invalid.'],
  [HttpStatus.UNAUTHORIZED]: ['UNAUTHENTICATED', 'Authentication is required.'],
  [HttpStatus.FORBIDDEN]: [
    'FORBIDDEN',
    'You do not have permission to perform this action.',
  ],
  [HttpStatus.NOT_FOUND]: [
    'NOT_FOUND',
    'The requested resource was not found.',
  ],
  [HttpStatus.CONFLICT]: [
    'CONFLICT',
    'The request conflicts with existing data.',
  ],
  // Only file uploads accept bodies large enough to hit this limit.
  [HttpStatus.PAYLOAD_TOO_LARGE]: [
    'DOCUMENT_TOO_LARGE',
    'The file exceeds the maximum upload size.',
  ],
};

/**
 * Converts every error into the stable error envelope. Unexpected errors are
 * logged server-side and returned as a generic 500 with no internal details.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(caught: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const exception = isDatabaseUnavailableError(caught)
      ? this.databaseUnavailable(caught)
      : caught;
    const [status, code, message] = this.describe(exception);
    if (exception instanceof ApiError && exception.retryAfterSeconds) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }
    const { requestId } = getLogContext();
    const body: ErrorEnvelope = {
      error: { code, message, ...(requestId ? { requestId } : {}) },
    };
    response.status(status).json(body);
  }

  /**
   * A database outage is transient: a controlled, retryable 503 instead of a
   * generic 500 (E8-T06). Connection details stay in the logs.
   */
  private databaseUnavailable(error: unknown): ApiError {
    this.logger.warn(`Database unavailable: ${describeDatabaseError(error)}`);
    return new ApiError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'SERVICE_UNAVAILABLE',
      'The service is temporarily unavailable. Please try again shortly.',
      DATABASE_RETRY_AFTER_SECONDS,
    );
  }

  private describe(exception: unknown): [number, ApiErrorCode, string] {
    if (exception instanceof ApiError) {
      return [exception.status, exception.code, exception.message];
    }
    // body-parser rejects JSON bodies over the configured limit (E8-T03).
    if ((exception as { type?: unknown } | null)?.type === 'entity.too.large') {
      return [
        HttpStatus.PAYLOAD_TOO_LARGE,
        'PAYLOAD_TOO_LARGE',
        'The request body is too large.',
      ];
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const known = HTTP_STATUS_CODES[status];
      if (known) return [status, ...known];
      if (status < 500) {
        return [
          status,
          'VALIDATION_FAILED',
          'The request could not be processed.',
        ];
      }
    }
    this.logger.error(
      'Unhandled error',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      'An unexpected error occurred.',
    ];
  }
}
