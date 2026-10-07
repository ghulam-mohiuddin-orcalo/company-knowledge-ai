import 'reflect-metadata';
import { loadEnvFileIfPresent, loadWorkerConfigOrExit } from '@cka/config';
import {
  createDatabasePool,
  describeDatabaseError,
  EMBEDDING_DIMENSIONS,
  pingDatabase,
} from '@cka/database';
import { Logger } from '@nestjs/common';
import { JsonLogger } from '@cka/observability';
import { NestFactory } from '@nestjs/core';
import { WorkerLoop } from './worker-loop.js';
import { WorkerModule } from './worker.module.js';

const STARTUP_DATABASE_TIMEOUT_MS = 5000;

// The worker runs as a Nest application context (no HTTP server).
async function bootstrap(): Promise<void> {
  // Fail fast on missing/invalid configuration before anything starts.
  loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
  const workerConfig = loadWorkerConfigOrExit();
  const { config, embedding } = workerConfig;
  const jsonLogger = new JsonLogger(config.app.logLevel, undefined, 'worker');
  Logger.overrideLogger(jsonLogger);
  const logger = new Logger('Worker');

  // The vector column has a fixed dimension; a different model needs a migration.
  if (embedding.dimensions !== EMBEDDING_DIMENSIONS) {
    console.error(
      `Invalid configuration. Fix the following environment variables:\n  - AI_EMBEDDING_DIMENSIONS: must be ${EMBEDDING_DIMENSIONS} to match the database vector column`,
    );
    process.exit(1);
  }

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

  const app = await NestFactory.createApplicationContext(
    WorkerModule.forRoot(workerConfig),
    { logger: jsonLogger },
  );
  app.enableShutdownHooks();
  app.get(WorkerLoop).start();

  logger.log(
    `Worker started (embedding model ${embedding.model}, ${embedding.dimensions} dimensions)`,
  );
}

await bootstrap();
