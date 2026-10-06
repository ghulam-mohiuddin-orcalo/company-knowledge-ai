import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiError, type ApiErrorCode } from './api-error.js';

export interface ErrorEnvelope {
  error: { code: ApiErrorCode; message: string };
}

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
};

/**
 * Converts every error into the stable error envelope. Unexpected errors are
 * logged server-side and returned as a generic 500 with no internal details.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, code, message] = this.describe(exception);
    const body: ErrorEnvelope = { error: { code, message } };
    response.status(status).json(body);
  }

  private describe(exception: unknown): [number, ApiErrorCode, string] {
    if (exception instanceof ApiError) {
      return [exception.status, exception.code, exception.message];
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
