import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { configureApp } from '../configure-app.js';
import { JsonLogger } from '@cka/observability';
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
      body?: FormData | string;
    },
  ): Promise<TestResponse>;
  close(): Promise<void>;
}

export interface TestResponse {
  status: number;
  /**
   * Parsed JSON. For error envelopes, the per-request `requestId` is moved to
   * `envelopeRequestId` so envelopes can be compared (e.g. foreign vs unknown IDs).
   */
  body: unknown;
  /** Raw response text (unmodified), for leak checks. */
  text: string;
  /** X-Request-Id response header. */
  requestId: string | null;
  headers: Headers;
  /** requestId found in the error envelope, if any. */
  envelopeRequestId?: string;
}

/** Boots the full API (all guards and filters) against a test database and identity provider. */
export async function startTestApi(
  databaseUrl: string,
  idp: TestIdentityProvider,
  env: NodeJS.ProcessEnv = {},
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
  /** Captures structured log output (silent by default). */
  logger: JsonLogger = new JsonLogger('error', () => undefined),
): Promise<TestApi> {
  const moduleRef = await override(
    Test.createTestingModule({
      imports: [
        AppModule.forRoot(
          createTestConfig({ DATABASE_URL: databaseUrl, ...idp.env(), ...env }),
        ),
      ],
    }),
  ).compile();
  const app = moduleRef.createNestApplication({ logger });
  configureApp(
    app,
    createTestConfig({ DATABASE_URL: databaseUrl, ...idp.env(), ...env })
      .config,
    logger,
  );
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

  return {
    app,
    async request(path, options = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        body: options.body,
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
      let envelopeRequestId: string | undefined;
      const error = (body as { error?: { requestId?: string } } | null)?.error;
      if (error && typeof error === 'object' && 'requestId' in error) {
        envelopeRequestId = error.requestId;
        delete error.requestId;
      }
      return {
        status: response.status,
        body,
        text,
        requestId: response.headers.get('x-request-id'),
        headers: response.headers,
        envelopeRequestId,
      };
    },
    close: () => app.close(),
  };
}
