import { HttpStatus } from '@nestjs/common';
import { ApiError } from './api-error.js';

const invalid = (message: string): ApiError =>
  new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', message);

/**
 * Accepts only a JSON object with the given keys. Unknown fields (for example a
 * client-supplied organizationId or userId) are rejected, not ignored.
 */
export function readJsonObject(
  body: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalid('The request body must be a JSON object.');
  }
  const unknown = Object.keys(body).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    throw invalid(`Unknown field(s): ${unknown.slice(0, 5).join(', ')}.`);
  }
  return body as Record<string, unknown>;
}

/** An optional string, trimmed; empty becomes undefined. */
export function readOptionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid(`${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw invalid(`${field} must be at most ${maxLength} characters.`);
  }
  return trimmed === '' ? undefined : trimmed;
}
