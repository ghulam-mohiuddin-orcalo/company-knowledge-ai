import { loadDatabaseConfig, loadEnvFileIfPresent } from '@cka/config';
import { createDatabasePool, pingDatabase } from './client.js';

loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
const databaseUrl = loadDatabaseConfig().url.reveal();

describe('createDatabasePool', () => {
  it('survives the server dropping an idle connection', async () => {
    const onIdleError = vi.fn();
    const pool = createDatabasePool(databaseUrl, onIdleError);
    const admin = createDatabasePool(databaseUrl);
    try {
      const { rows } = await pool.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      await admin.query('SELECT pg_terminate_backend($1)', [rows[0]!.pid]);

      // Without an error listener this would be an unhandled 'error' event and crash the process.
      await vi.waitFor(() => expect(onIdleError).toHaveBeenCalled());
      await expect(pingDatabase(pool, 2000)).resolves.toBeUndefined();
    } finally {
      await pool.end();
      await admin.end();
    }
  });

  it('survives the server dropping a checked-out connection between queries (E8-T06)', async () => {
    const pool = createDatabasePool(databaseUrl);
    const admin = createDatabasePool(databaseUrl);
    const uncaught = vi.fn();
    process.on('uncaughtException', uncaught);
    try {
      // Held between statements, as a transaction does.
      const client = await pool.connect();
      const { rows } = await client.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      await admin.query('SELECT pg_terminate_backend($1)', [rows[0]!.pid]);
      await new Promise((resolve) => setTimeout(resolve, 200));

      await expect(client.query('SELECT 1')).rejects.toThrow();
      client.release();
      expect(uncaught).not.toHaveBeenCalled();
      await expect(pingDatabase(pool, 2000)).resolves.toBeUndefined();
    } finally {
      process.off('uncaughtException', uncaught);
      await pool.end();
      await admin.end();
    }
  });
});
