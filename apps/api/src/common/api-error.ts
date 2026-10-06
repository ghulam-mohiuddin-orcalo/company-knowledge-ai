import { HttpStatus } from '@nestjs/common';

/** Stable machine-readable error codes returned in the error envelope (TDD §19.1). */
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'AUTH_PROVIDER_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'ORGANIZATION_SELECTION_REQUIRED'
  | 'ORGANIZATION_SUSPENDED'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'DOCUMENT_UNSUPPORTED_TYPE'
  | 'DOCUMENT_TOO_LARGE'
  | 'DOCUMENT_EMPTY'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/**
 * An error that is safe to return to clients. `message` must never contain
 * secrets, SQL, provider errors, stack traces or another tenant's data.
 */
export class ApiError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static unauthenticated(): ApiError {
    return new ApiError(
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
      'Authentication is required.',
    );
  }

  static forbidden(
    message = 'You do not have permission to perform this action.',
  ): ApiError {
    return new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
  }

  static notFound(): ApiError {
    return new ApiError(
      HttpStatus.NOT_FOUND,
      'NOT_FOUND',
      'The requested resource was not found.',
    );
  }
}
