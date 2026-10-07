import { FakeGenerationProvider, HashedTermEmbeddingProvider } from '@cka/ai';
import { type Database, EMBEDDING_DIMENSIONS } from '@cka/database';
import { JsonLogger } from '@cka/observability';
import { DATABASE } from './database/database.module.js';
import { GENERATION_PROVIDER } from './rag/rag.service.js';
import { EMBEDDING_PROVIDER } from './retrieval/retrieval.service.js';
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

const embedder = new HashedTermEmbeddingProvider(EMBEDDING_DIMENSIONS);
const SECRET_FACT = 'Project Nightingale budget is 4.2 million pounds.';
const QUESTION = 'What is the Project Nightingale budget in pounds?';

describe('structured logging and correlation (E8-T01)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;
  const lines: string[] = [];
  const logs = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(
      db.url,
      idp,
      { EVIDENCE_MIN_TOP_SCORE: '0.3', EVIDENCE_MIN_HIT_SCORE: '0.2' },
      (builder) =>
        builder
          .overrideProvider(EMBEDDING_PROVIDER)
          .useValue(embedder)
          .overrideProvider(GENERATION_PROVIDER)
          .useValue(
            new FakeGenerationProvider(
              () => 'The budget is 4.2 million pounds [SOURCE_1].',
            ),
          ),
      new JsonLogger('debug', (line) => lines.push(line), 'api'),
    );
    fx = await seedTenantFixtures(api.app, idp, 'obs');
    await seedIndexedDocument(
      api.app.get<Database>(DATABASE),
      { organizationId: fx.orgA.id, uploadedBy: fx.adminA.userId },
      {
        filename: 'Budget.txt',
        chunks: [
          { content: SECRET_FACT, embedding: embedder.vector(SECRET_FACT) },
        ],
      },
    );
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  it('assigns a request ID to every response and error envelope', async () => {
    const response = await api.request('/v1/me');

    expect(response.status).toBe(401);
    expect(response.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(response.envelopeRequestId).toBe(response.requestId);
  });

  it('keeps a well-formed incoming request ID and replaces unsafe ones', async () => {
    const kept = await api.request('/health', {
      headers: { 'x-request-id': 'trace_abc12345' },
    });
    const replaced = await api.request('/health', {
      headers: { 'x-request-id': 'x"}\\u000a{"level":"error' },
    });

    expect(kept.requestId).toBe('trace_abc12345');
    expect(replaced.requestId).toMatch(/^req_/);
  });

  it('logs each request with correlation and tenant-safe context', async () => {
    const token = await fx.memberA.token();
    const response = await api.request(
      '/v1/documents?limit=5&probe=secret-query-value',
      { token },
    );

    const entry = logs().find(
      (l) => l.msg === 'http_request' && l.requestId === response.requestId,
    );
    expect(entry).toMatchObject({
      level: 'log',
      service: 'api',
      method: 'GET',
      path: '/v1/documents',
      status: 200,
      durationMs: expect.any(Number),
      userId: fx.memberA.userId,
      organizationId: fx.orgA.id,
    });
    expect(lines.join('\n')).not.toContain('secret-query-value');
  });

  it('never logs tokens, questions or document content', async () => {
    const token = await fx.memberA.token();
    const conversation = await api.request('/v1/conversations', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const asked = await api.request(
      `/v1/conversations/${(conversation.body as { id: string }).id}/messages`,
      {
        method: 'POST',
        token,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: QUESTION }),
      },
    );
    const form = new FormData();
    form.append(
      'file',
      new Blob([SECRET_FACT], { type: 'text/plain' }),
      'secret.txt',
    );
    await api.request('/v1/documents', {
      method: 'POST',
      body: form,
      token: await fx.adminA.token(),
    });

    expect(asked.status).toBe(201);
    const all = lines.join('\n');
    expect(all).toContain(asked.requestId!);
    for (const secret of [
      token,
      'Nightingale',
      '4.2 million',
      'secret.txt',
      'Bearer ey',
    ]) {
      expect(all).not.toContain(secret);
    }
    // RAG log lines carry the request's correlation ID.
    expect(
      logs().some(
        (l) => l.context === 'RagService' && l.requestId === asked.requestId,
      ),
    ).toBe(true);
  });
});
