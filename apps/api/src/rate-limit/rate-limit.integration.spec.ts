import { HashedTermEmbeddingProvider } from '@cka/ai';
import { EMBEDDING_DIMENSIONS } from '@cka/database';
import { EMBEDDING_PROVIDER } from '../retrieval/retrieval.service.js';
import { startTestApi, type TestApi } from '../testing/test-api.js';
import {
  seedTenantFixtures,
  type TenantFixtures,
} from '../testing/tenant-fixtures.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from '../testing/test-identity-provider.js';

const RATE_LIMITED = {
  error: {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please wait and try again.',
  },
};

describe('rate limiting and abuse controls (E8-T03)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  const apis: TestApi[] = [];

  // No documents are indexed, so questions end as no-answer without generation.
  const start = async (env: NodeJS.ProcessEnv) => {
    const api = await startTestApi(db.url, idp, env, (builder) =>
      builder
        .overrideProvider(EMBEDDING_PROVIDER)
        .useValue(new HashedTermEmbeddingProvider(EMBEDDING_DIMENSIONS)),
    );
    apis.push(api);
    return api;
  };
  const upload = (api: TestApi, token: string, name: string) => {
    const form = new FormData();
    form.append(
      'file',
      new Blob(['Rate limit test'], { type: 'text/plain' }),
      name,
    );
    return api.request('/v1/documents', { method: 'POST', body: form, token });
  };
  const ask = async (api: TestApi, token: string) => {
    const conversation = await api.request('/v1/conversations', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const { id } = conversation.body as { id: string };
    return (question: string) =>
      api.request(`/v1/conversations/${id}/messages`, {
        method: 'POST',
        token,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: question }),
      });
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
  });

  afterAll(async () => {
    for (const api of apis) await api.close();
    await idp?.close();
    await db?.drop();
  });

  it('limits requests per client IP with Retry-After, never health probes', async () => {
    const api = await start({ RATE_LIMIT_REQUESTS_PER_IP: '3' });
    const token = await idp.token('rl-ip-user');

    const allowed = [];
    for (let i = 0; i < 3; i++) {
      allowed.push((await api.request('/v1/me', { token })).status);
    }
    const limited = await api.request('/v1/me', { token });

    expect(allowed).toEqual([200, 200, 200]);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual(RATE_LIMITED);
    expect(limited.envelopeRequestId).toBe(limited.requestId);
    const retryAfter = Number(
      (await fetch(`${await api.app.getUrl()}/v1/me`)).headers.get(
        'retry-after',
      ),
    );
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect((await api.request('/health')).status).toBe(200);
    expect((await api.request('/ready')).status).toBe(200);
  });

  it('ignores spoofed X-Forwarded-For unless a proxy is trusted', async () => {
    const api = await start({ RATE_LIMIT_REQUESTS_PER_IP: '2' });
    const spoofed = (n: number) =>
      api.request('/v1/me', {
        headers: { 'x-forwarded-for': `203.0.113.${n}` },
      });

    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await spoofed(i)).status);

    expect(statuses).toEqual([401, 401, 429]);
  });

  it('uses the forwarded client IP behind a trusted proxy', async () => {
    const api = await start({
      RATE_LIMIT_REQUESTS_PER_IP: '1',
      TRUST_PROXY: 'true',
    });
    const from = (ip: string) =>
      api.request('/v1/me', { headers: { 'x-forwarded-for': ip } });

    expect((await from('198.51.100.1')).status).toBe(401);
    expect((await from('198.51.100.2')).status).toBe(401);
    expect((await from('198.51.100.1')).status).toBe(429);
  });

  it('throttles repeated authentication failures before verifying tokens', async () => {
    const api = await start({ RATE_LIMIT_AUTH_FAILURES_PER_IP: '3' });
    const valid = await idp.token('rl-auth-user');

    expect((await api.request('/v1/me', { token: valid })).status).toBe(200);
    const failures = [];
    failures.push((await api.request('/v1/me')).status);
    failures.push((await api.request('/v1/me', { token: 'not-a-jwt' })).status);
    failures.push(
      (await api.request('/v1/me', { token: `${valid.slice(0, -4)}AAAA` }))
        .status,
    );
    const blocked = await api.request('/v1/me', { token: valid });

    expect(failures).toEqual([401, 401, 401]);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual(RATE_LIMITED);
    expect((await api.request('/health')).status).toBe(200);
  });

  describe('per-user operation limits', () => {
    let api: TestApi;
    let fx: TenantFixtures;

    beforeAll(async () => {
      api = await start({
        RATE_LIMIT_ASKS_PER_USER: '2',
        RATE_LIMIT_UPLOADS_PER_USER: '2',
      });
      fx = await seedTenantFixtures(api.app, idp, 'rl');
    });

    it('limits questions per user without affecting other users', async () => {
      const askA = await ask(api, await fx.memberA.token());
      const askB = await ask(api, await fx.memberB.token());

      const statuses = [
        (await askA('What is the travel policy?')).status,
        (await askA('What is the leave policy?')).status,
      ];
      const limited = await askA('What is the expense policy?');

      expect(statuses).toEqual([201, 201]);
      expect(limited.status).toBe(429);
      expect(limited.body).toEqual(RATE_LIMITED);
      expect((await askB('What is the travel policy?')).status).toBe(201);
      // Reads are not limited per user.
      const list = await api.request('/v1/conversations', {
        token: await fx.memberA.token(),
      });
      expect(list.status).toBe(200);
    });

    it('limits uploads per user', async () => {
      const token = await fx.adminA.token();

      const statuses = [
        (await upload(api, token, 'one.txt')).status,
        (await upload(api, token, 'two.txt')).status,
      ];
      const limited = await upload(api, token, 'three.txt');

      expect(statuses).toEqual([201, 201]);
      expect(limited.status).toBe(429);
      expect(limited.body).toEqual(RATE_LIMITED);
      expect((await upload(api, await fx.adminB.token(), 'b.txt')).status).toBe(
        201,
      );
    });

    it('does not count requests rejected by authorization', async () => {
      const token = await fx.memberB.token();
      for (let i = 0; i < 3; i++) {
        expect((await upload(api, token, 'denied.txt')).status).toBe(403);
      }
    });
  });

  it('rejects oversized JSON bodies with a controlled error', async () => {
    const api = await start({});
    const fx = await seedTenantFixtures(api.app, idp, 'rl-size');
    const askA = await ask(api, await fx.memberA.token());

    const response = await askA('x'.repeat(70 * 1024));

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body is too large.',
      },
    });
  });
});
