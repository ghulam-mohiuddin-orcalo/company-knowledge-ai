import {
  FakeGenerationProvider,
  type GenerationRequest,
  HashedTermEmbeddingProvider,
} from '@cka/ai';
import {
  createDatabase,
  createDatabasePool,
  type DatabasePool,
  documents,
  EMBEDDING_DIMENSIONS,
  messages,
} from '@cka/database';
import {
  type DatabaseOutageProxy,
  startDatabaseOutageProxy,
} from '@cka/database/testing';
import { ObjectNotFoundError, type ObjectStorage } from '@cka/storage';
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE_POOL } from './database/database.module.js';
import { GENERATION_PROVIDER } from './rag/rag.service.js';
import { EMBEDDING_PROVIDER } from './retrieval/retrieval.service.js';
import { OBJECT_STORAGE } from './storage/storage.module.js';
import { seedIndexedDocument } from './testing/chunk-fixtures.js';
import { startTestApi, type TestApi } from './testing/test-api.js';
import {
  seedTenantFixtures,
  type TenantFixtures,
} from './testing/tenant-fixtures.js';
import {
  createTestDatabase,
  type TestDatabase,
} from './testing/test-database.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from './testing/test-identity-provider.js';

const METRICS_TOKEN = 'resilience-metrics-token';
const UNAVAILABLE = {
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message:
      'The service is temporarily unavailable. Please try again shortly.',
  },
};
const FACT =
  'Employees may carry over five unused leave days into the next year.';

/** Database failure boundaries and recovery of the API (E8-T06). */
describe('API failure and recovery (E8-T06)', () => {
  const embedder = new HashedTermEmbeddingProvider(EMBEDDING_DIMENSIONS);
  let onGenerate: () => void = () => undefined;
  const generation = new FakeGenerationProvider(
    (request: GenerationRequest) => {
      onGenerate();
      return request.user.includes('carry over')
        ? 'Five unused leave days carry over [SOURCE_1].'
        : 'NO_ANSWER';
    },
  );
  let db: TestDatabase;
  let proxy: DatabaseOutageProxy;
  let pool: DatabasePool;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;

  const leaks = (text: string) =>
    expect(text).not.toMatch(
      /ECONN|127\.0\.0\.1|postgres|cka_local_dev|terminated/i,
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    proxy = await startDatabaseOutageProxy(db.url);
    pool = createDatabasePool(db.url);
    idp = await startTestIdentityProvider();
    // The API reaches PostgreSQL only through the outage proxy.
    api = await startTestApi(
      proxy.url,
      idp,
      {
        METRICS_TOKEN,
        EVIDENCE_MIN_TOP_SCORE: '0.3',
        EVIDENCE_MIN_HIT_SCORE: '0.2',
      },
      (builder) =>
        builder
          .overrideProvider(EMBEDDING_PROVIDER)
          .useValue(embedder)
          .overrideProvider(GENERATION_PROVIDER)
          .useValue(generation),
    );
    fx = await seedTenantFixtures(api.app, idp, 'res');
    await seedIndexedDocument(
      createDatabase(pool),
      { organizationId: fx.orgA.id, uploadedBy: fx.adminA.userId },
      {
        filename: 'Leave Policy.txt',
        chunks: [{ content: FACT, embedding: embedder.vector(FACT) }],
      },
    );
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await pool?.end();
    await proxy?.close();
    await db?.drop();
  });

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    proxy.restore();
    onGenerate = () => undefined;
  });

  it('answers a database outage with a controlled, retryable 503, then recovers', async () => {
    const token = await fx.memberA.token();
    expect((await api.request('/v1/me', { token })).status).toBe(200);

    proxy.outage();
    const me = await api.request('/v1/me', { token });
    const documentsList = await api.request('/v1/documents', { token });
    const health = await api.request('/health');
    const ready = await api.request('/ready');
    const metrics = await api.request('/metrics', { token: METRICS_TOKEN });

    expect(me.status).toBe(503);
    expect(me.body).toEqual(UNAVAILABLE);
    expect(me.headers.get('retry-after')).toBe('5');
    expect(documentsList.body).toEqual(UNAVAILABLE);
    leaks(me.text);
    // Liveness stays up (no restart storm); readiness takes the instance out.
    expect(health.status).toBe(200);
    expect(ready.status).toBe(503);
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('cka_metrics_database_up 0');
    expect(metrics.text).toContain('cka_http_requests_total');
    expect(Logger.prototype.error).not.toHaveBeenCalledWith(
      'Unhandled error',
      expect.anything(),
    );

    proxy.restore();
    expect((await api.request('/v1/me', { token })).status).toBe(200);
    expect((await api.request('/ready')).status).toBe(200);
    expect(
      (await api.request('/metrics', { token: METRICS_TOKEN })).text,
    ).toContain('cka_metrics_database_up 1');
  });

  it('leaves no stored object or document behind when the database fails mid-upload', async () => {
    const storage = api.app.get<ObjectStorage>(OBJECT_STORAGE);
    const put = storage.putObject.bind(storage);
    let storedKey = '';
    vi.spyOn(storage, 'putObject').mockImplementation(async (key, ...rest) => {
      await put(key, ...rest);
      storedKey = key;
      proxy.outage(); // the database fails right after the object is stored
    });
    const form = new FormData();
    form.append(
      'file',
      new Blob(['Outage upload'], { type: 'text/plain' }),
      'o.txt',
    );

    const response = await api.request('/v1/documents', {
      method: 'POST',
      body: form,
      token: await fx.adminA.token(),
    });
    proxy.restore();

    expect(response.status).toBe(503);
    expect(storedKey).not.toBe('');
    await expect(storage.getObject(storedKey)).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
    const rows = await createDatabase(pool)
      .select()
      .from(documents)
      .where(eq(documents.storageKey, storedKey));
    expect(rows).toEqual([]);
  });

  it('completes an interrupted answer exactly once when the client retries', async () => {
    const token = await fx.memberA.token();
    const conversation = await api.request('/v1/conversations', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const conversationId = (conversation.body as { id: string }).id;
    const ask = () =>
      api.request(`/v1/conversations/${conversationId}/messages`, {
        method: 'POST',
        token,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'retry-after-outage-1',
        },
        body: JSON.stringify({ content: 'How many leave days carry over?' }),
      });
    // The database fails while the model is answering: the reply cannot be saved.
    onGenerate = () => proxy.outage();

    const interrupted = await ask();
    proxy.restore();
    onGenerate = () => undefined;
    const retried = await ask();
    const again = await ask();

    expect(interrupted.status).toBe(503);
    expect(interrupted.body).toEqual(UNAVAILABLE);
    expect(retried.status).toBe(201);
    expect(retried.body).toMatchObject({
      answer: { outcome: 'ANSWERED', citations: [expect.anything()] },
    });
    expect(again.body).toEqual(retried.body);
    const stored = await createDatabase(pool)
      .select({ role: messages.role })
      .from(messages)
      .where(eq(messages.conversationId, conversationId));
    expect(stored.map((m) => m.role).sort()).toEqual(['ASSISTANT', 'USER']);
  });

  it('returns every connection to the pool after outages (no leaked clients)', async () => {
    const apiPool = api.app.get<DatabasePool>(DATABASE_POOL);

    // After the outages above, nothing may stay checked out; otherwise every
    // outage would permanently shrink the pool until the API stalls.
    await vi.waitFor(() =>
      expect(apiPool.totalCount - apiPool.idleCount).toBe(0),
    );
    expect(apiPool.waitingCount).toBe(0);
    expect(
      (await api.request('/v1/me', { token: await fx.memberA.token() })).status,
    ).toBe(200);
  });
});
