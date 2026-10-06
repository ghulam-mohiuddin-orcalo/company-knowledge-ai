import 'reflect-metadata';
import { loadApiConfigOrExit, loadEnvFileIfPresent } from '@cka/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // Fail fast on missing/invalid configuration before anything starts.
  loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
  const apiConfig = loadApiConfigOrExit();

  const app = await NestFactory.create(AppModule.forRoot(apiConfig));
  app.enableShutdownHooks();
  await app.listen(apiConfig.config.app.port);
}

await bootstrap();
