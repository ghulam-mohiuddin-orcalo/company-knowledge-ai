import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type DatabasePool = pg.Pool;

/**
 * Creates the PostgreSQL connection pool. Connections are opened lazily on first use.
 * Idle-connection errors (e.g. the server restarting) are reported to `onIdleError`
 * instead of crashing the process; the pool discards the broken connection itself.
 */
export function createDatabasePool(
  databaseUrl: string,
  onIdleError: (error: Error) => void = () => undefined,
): DatabasePool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', onIdleError);
  // pg-pool listens for errors only on idle clients. A checked-out client
  // whose connection drops between queries (e.g. a database outage during a
  // transaction) would otherwise emit an unhandled 'error' and crash the
  // process (E8-T06). Its pending and later queries fail with the error, and
  // the pool discards it on release.
  pool.on('connect', (client) => {
    client.on('error', () => undefined);
  });
  return pool;
}

export type Database = NodePgDatabase<typeof schema>;

/** Typed query builder over the pool. Repositories use this; never raw string-built SQL. */
export function createDatabase(pool: DatabasePool): Database {
  return drizzle(pool, { schema });
}

/** Verifies the database accepts queries, failing after `timeoutMs`. */
export async function pingDatabase(
  pool: DatabasePool,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Database ping timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([pool.query('SELECT 1'), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Describes a database error for logs without connection details. Unwraps
 * errors wrapped by Drizzle; driver messages do not include credentials.
 */
export function describeDatabaseError(error: unknown): string {
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  const { code } = (cause ?? {}) as { code?: string };
  const message = cause instanceof Error ? cause.message : 'unknown error';
  return code ? `(code ${code}) ${message}` : message;
}

/** Socket-level and PostgreSQL connection/availability error codes. */
const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EHOSTUNREACH',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
]);
const UNAVAILABLE_MESSAGES =
  /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error|connection timeout/i;

/**
 * True when the database is unreachable or refusing work (outage, restart,
 * connection exhaustion) — a transient condition callers report as "service
 * unavailable", unlike query or constraint errors (E8-T06).
 */
export function isDatabaseUnavailableError(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 5;
    current = current.cause, depth++
  ) {
    const { code } = current as { code?: unknown };
    if (
      typeof code === 'string' &&
      (UNAVAILABLE_CODES.has(code) || code.startsWith('08'))
    ) {
      return true;
    }
    if (UNAVAILABLE_MESSAGES.test(current.message)) return true;
  }
  return false;
}
