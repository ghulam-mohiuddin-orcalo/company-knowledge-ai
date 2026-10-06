import pg from 'pg';

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
  return pool;
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
