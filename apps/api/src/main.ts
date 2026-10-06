import 'reflect-metadata';
import { loadConfigOrExit, loadEnvFileIfPresent } from '@cka/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // Fail fast on missing/invalid configuration before anything starts.
  loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
  const config = loadConfigOrExit();

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(config.app.port);
}

await bootstrap();
