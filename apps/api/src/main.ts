import 'reflect-metadata';
import { loadApiConfigOrExit, loadEnvFileIfPresent } from '@cka/config';
import { EMBEDDING_DIMENSIONS } from '@cka/database';
import { JsonLogger } from '@cka/observability';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

async function bootstrap(): Promise<void> {
  // Fail fast on missing/invalid configuration before anything starts.
  loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
  const apiConfig = loadApiConfigOrExit();
  // Query vectors must match the indexed vector column.
  if (apiConfig.embedding.dimensions !== EMBEDDING_DIMENSIONS) {
    console.error(
      `Invalid configuration. Fix the following environment variables:\n  - AI_EMBEDDING_DIMENSIONS: must be ${EMBEDDING_DIMENSIONS} to match the database vector column`,
    );
    process.exit(1);
  }

  const logger = new JsonLogger(
    apiConfig.config.app.logLevel,
    undefined,
    'api',
  );
  const app = await NestFactory.create(AppModule.forRoot(apiConfig), {
    logger,
    bodyParser: true,
  });
  configureApp(app, apiConfig.config, logger);
  app.enableShutdownHooks();
  await app.listen(apiConfig.config.app.port);
}

await bootstrap();
