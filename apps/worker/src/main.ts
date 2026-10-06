import 'reflect-metadata';
import { loadConfigOrExit, loadEnvFileIfPresent } from '@cka/config';
import {
  createDatabasePool,
  describeDatabaseError,
  pingDatabase,
} from '@cka/database';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

const STARTUP_DATABASE_TIMEOUT_MS = 5000;

// The worker runs as a Nest application context (no HTTP server).
async function bootstrap(): Promise<void> {
  // Fail fast on missing/invalid configuration before anything starts.
  loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
  const config = loadConfigOrExit();
  const logger = new Logger('Worker');

  // Startup health: the worker cannot process jobs without PostgreSQL, so an
  // unreachable database is a startup failure rather than a hidden one.
  const pool = createDatabasePool(config.database.url.reveal());
  try {
    await pingDatabase(pool, STARTUP_DATABASE_TIMEOUT_MS);
    logger.log('Startup health: database up');
  } catch (error) {
    logger.error(
      `Startup health: database down ${describeDatabaseError(error)}`,
    );
    process.exit(1);
  } finally {
    await pool.end();
  }

  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  // Keep the process alive until a job loop exists to do so (E3-T06).
  const keepAlive = setInterval(() => undefined, 60_000);
  const shutdown = (): void => clearInterval(keepAlive);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.log('Worker started');
}

await bootstrap();
