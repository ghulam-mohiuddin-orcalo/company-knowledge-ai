import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PageRequest {
  limit: number;
  after?: { createdAt: Date; id: string };
}

const invalid = (message: string): ApiError =>
  new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', message);

/** Parses `limit` and the opaque `cursor`; rejects (rather than coerces) bad values. */
export function parsePageRequest(query: {
  limit?: unknown;
  cursor?: unknown;
}): PageRequest {
  let limit = DEFAULT_PAGE_SIZE;
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^\d{1,3}$/.test(query.limit)) {
      throw invalid(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
    }
    limit = Number(query.limit);
    if (limit < 1 || limit > MAX_PAGE_SIZE) {
      throw invalid(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
    }
  }
  if (query.cursor === undefined) return { limit };
  if (typeof query.cursor !== 'string' || query.cursor.length > 200) {
    throw invalid('cursor is invalid.');
  }
  return { limit, after: decodeCursor(query.cursor) };
}

export function encodeCursor(item: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify([item.createdAt.toISOString(), item.id]),
  ).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      ISO_TIMESTAMP.test(value[0]) &&
      typeof value[1] === 'string' &&
      UUID.test(value[1])
    ) {
      const createdAt = new Date(value[0]);
      if (!Number.isNaN(createdAt.getTime())) {
        return { createdAt, id: value[1] };
      }
    }
  } catch {
    // fall through
  }
  throw invalid('cursor is invalid.');
}
