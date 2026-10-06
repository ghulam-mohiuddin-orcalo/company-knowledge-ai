import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { createTestConfig } from './test-config.js';
import type { TestIdentityProvider } from './test-identity-provider.js';

export interface TestApi {
  app: INestApplication;
  /** Calls the API over real HTTP. */
  request(
    path: string,
    options?: {
      token?: string;
      headers?: Record<string, string>;
      method?: string;
    },
  ): Promise<{ status: number; body: unknown; text: string }>;
  close(): Promise<void>;
}

/** Boots the full API (all guards and filters) against a test database and identity provider. */
export async function startTestApi(
  databaseUrl: string,
  idp: TestIdentityProvider,
): Promise<TestApi> {
  const app = await NestFactory.create(
    AppModule.forRoot(
      createTestConfig({ DATABASE_URL: databaseUrl, ...idp.env() }),
    ),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

  return {
    app,
    async request(path, options = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          ...(options.token
            ? { authorization: `Bearer ${options.token}` }
            : {}),
          ...options.headers,
        },
      });
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { status: response.status, body, text };
    },
    close: () => app.close(),
  };
}
