import 'reflect-metadata';
import { loadConfigOrExit, loadEnvFileIfPresent } from '@cka/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

// The worker runs as a Nest application context (no HTTP server).
async function bootstrap(): Promise<void> {
  // Fail fast on missing/invalid configuration before anything starts.
  loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
  loadConfigOrExit();

  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  // Keep the process alive until a job loop exists to do so (E3-T06).
  const keepAlive = setInterval(() => undefined, 60_000);
  const shutdown = (): void => clearInterval(keepAlive);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  new Logger('Worker').log('Worker started');
}

await bootstrap();
