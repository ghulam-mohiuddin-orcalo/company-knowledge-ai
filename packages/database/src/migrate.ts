import { fileURLToPath } from 'node:url';
import { loadDatabaseConfigOrExit, loadEnvFileIfPresent } from '@cka/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { isMainModule } from './cli.js';
import { describeDatabaseError } from './client.js';

const migrationsFolder = fileURLToPath(
  new URL('../migrations', import.meta.url),
);

/** Applies all pending migrations. Already-applied migrations are skipped. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

// Explicit deployment/CI/local step; never run automatically on application startup.
if (isMainModule(import.meta.url)) {
  loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
  const { url } = loadDatabaseConfigOrExit();
  try {
    await runMigrations(url.reveal());
    console.log('Database migrations applied');
  } catch (error) {
    console.error(`Database migration failed: ${describeDatabaseError(error)}`);
    process.exit(1);
  }
}
