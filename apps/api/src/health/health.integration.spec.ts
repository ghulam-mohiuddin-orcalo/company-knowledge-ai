import { loadDatabaseConfig, loadEnvFileIfPresent } from '@cka/config';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { createTestConfig } from '../testing/test-config.js';

// Requires a running, migrated PostgreSQL (`pnpm infra:up`), like CI's database job.
loadEnvFileIfPresent(new URL('../../../../.env', import.meta.url));
const databaseUrl = loadDatabaseConfig().url.reveal();

async function startApi(
  url: string,
): Promise<{ app: INestApplication; baseUrl: string }> {
  const app = await NestFactory.create(
    AppModule.forRoot(createTestConfig({ DATABASE_URL: url })),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: await app.getUrl() };
}

describe('health endpoints (real PostgreSQL)', () => {
  it('reports ready when PostgreSQL is reachable', async () => {
    const { app, baseUrl } = await startApi(databaseUrl);
    try {
      const health = await fetch(`${baseUrl}/health`);
      const ready = await fetch(`${baseUrl}/ready`);

      expect(health.status).toBe(200);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({
        status: 'ok',
        checks: { database: 'up' },
      });
    } finally {
      await app.close();
    }
  });

  it('stays live but not ready when PostgreSQL is unreachable', async () => {
    const unreachable = new URL(databaseUrl);
    unreachable.port = '1';
    const { app, baseUrl } = await startApi(unreachable.toString());
    try {
      const health = await fetch(`${baseUrl}/health`);
      const ready = await fetch(`${baseUrl}/ready`);

      expect(health.status).toBe(200);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({
        status: 'unavailable',
        checks: { database: 'down' },
      });
    } finally {
      await app.close();
    }
  });
});
