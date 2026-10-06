import { randomUUID } from 'node:crypto';
import {
  FakeGenerationProvider,
  GenerationProviderError,
  type GenerationRequest,
  HashedTermEmbeddingProvider,
} from '@cka/ai';
import { type Database, EMBEDDING_DIMENSIONS } from '@cka/database';
import { DATABASE } from '../database/database.module.js';
import { EMBEDDING_PROVIDER } from '../retrieval/retrieval.service.js';
import { seedIndexedDocument } from '../testing/chunk-fixtures.js';
import { startTestApi, type TestApi } from '../testing/test-api.js';
import { expectDeniedWithoutLeak } from '../testing/tenant-boundary.js';
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
import { SYSTEM_PROMPT } from './prompt-builder.js';
import { GENERATION_PROVIDER, NO_ANSWER_MESSAGE } from './rag.service.js';

const embedder = new HashedTermEmbeddingProvider(EMBEDDING_DIMENSIONS);

describe('Ask API (E5-T05)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;
  let respond: (request: GenerationRequest) => string;
  const generation = new FakeGenerationProvider((r) => respond(r), 'fake-llm');

  const json = (body: unknown) => JSON.stringify(body);
  const newConversation = async (token: string) => {
    const response = await api.request('/v1/conversations', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return (response.body as { id: string }).id;
  };
  const ask = async (
    token: string,
    conversationId: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    api.request(`/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : json(body),
    });

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(
      db.url,
      idp,
      {
        EVIDENCE_MIN_TOP_SCORE: '0.3',
        EVIDENCE_MIN_HIT_SCORE: '0.2',
        QUESTION_MAX_CHARS: '300',
      },
      (builder) =>
        builder
          .overrideProvider(EMBEDDING_PROVIDER)
          .useValue(embedder)
          .overrideProvider(GENERATION_PROVIDER)
          .useValue(generation),
    );
    fx = await seedTenantFixtures(api.app, idp, 'ask');
    const content =
      'Every employee receives 27 days of paid annual leave per year.';
    await seedIndexedDocument(
      api.app.get<Database>(DATABASE),
      { organizationId: fx.orgA.id, uploadedBy: fx.adminA.userId },
      {
        filename: 'Handbook.docx',
        chunks: [{ content, embedding: embedder.vector(content) }],
      },
    );
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  beforeEach(() => {
    generation.requests.length = 0;
    respond = () => 'You receive 27 days of paid annual leave [SOURCE_1].';
  });

  it('answers an answerable question with a grounded answer', async () => {
    const token = await fx.memberA.token();
    const conversationId = await newConversation(token);

    const response = await ask(token, conversationId, {
      content: '  How many days of annual leave do employees get? ',
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      question: expect.objectContaining({
        role: 'USER',
        content: 'How many days of annual leave do employees get?',
      }),
      answer: expect.objectContaining({
        role: 'ASSISTANT',
        outcome: 'ANSWERED',
        content: 'You receive 27 days of paid annual leave [1].',
        citations: [
          {
            id: expect.stringMatching(/^[0-9a-f-]{36}$/),
            ordinal: 1,
            documentId: expect.any(String),
            documentName: 'Handbook.docx',
            locator: { page: null, section: null },
            excerpt:
              'Every employee receives 27 days of paid annual leave per year.',
            available: true,
          },
        ],
      }),
    });
    // Hidden prompts, model and usage never reach the client.
    expect(response.text).not.toContain(SYSTEM_PROMPT.slice(0, 40));
    expect(response.text).not.toMatch(/fake-llm|<sources>|inputTokens/);
    const thread = await api.request(
      `/v1/conversations/${conversationId}/messages`,
      {
        token,
      },
    );
    expect((thread.body as { items: unknown[] }).items).toHaveLength(2);
  });

  it('returns the explicit no-answer for unanswerable questions', async () => {
    const token = await fx.memberA.token();

    const response = await ask(token, await newConversation(token), {
      content: 'What is a good recipe for chocolate cake?',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      answer: { outcome: 'NO_ANSWER', content: NO_ANSWER_MESSAGE },
    });
    expect(generation.requests).toHaveLength(0);
  });

  it.each([
    ['a missing content field', {}],
    ['empty content', { content: '   ' }],
    ['non-string content', { content: 42 }],
    ['an overlong question', { content: 'x'.repeat(301) }],
    ['client-supplied tenant fields', { content: 'q', organizationId: 'x' }],
    ['malformed JSON', '{"content":'],
  ])('rejects %s with 400', async (_, body) => {
    const token = await fx.memberA.token();
    const response = await ask(token, await newConversation(token), body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(generation.requests).toHaveLength(0);
  });

  it('accepts a question at the length limit', async () => {
    const token = await fx.memberA.token();

    const response = await ask(token, await newConversation(token), {
      content: `annual leave ${'x'.repeat(287)}`,
    });

    expect(response.status).toBe(201);
  });

  it('rejects invalid idempotency keys', async () => {
    const token = await fx.memberA.token();

    const response = await ask(
      token,
      await newConversation(token),
      { content: 'q' },
      { 'idempotency-key': 'bad key!' },
    );

    expect(response.status).toBe(400);
  });

  it('returns a safe, retryable error on provider failure, then succeeds on retry', async () => {
    const token = await fx.memberA.token();
    const conversationId = await newConversation(token);
    respond = () => {
      throw new GenerationProviderError('PROVIDER_UNAVAILABLE', 503);
    };
    const headers = { 'idempotency-key': 'ask-retry-1' };
    const question = {
      content: 'How many days of annual leave do employees get?',
    };

    const failed = await ask(token, conversationId, question, headers);

    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({
      error: {
        code: 'AI_PROVIDER_UNAVAILABLE',
        message: 'The assistant is temporarily unavailable. Please try again.',
      },
    });
    expect(failed.text).not.toMatch(
      /HTTP 503|SOURCE_|stack|GenerationProviderError/,
    );

    respond = () => 'You receive 27 days [SOURCE_1].';
    const retried = await ask(token, conversationId, question, headers);
    const replayed = await ask(token, conversationId, question, headers);

    expect(retried.status).toBe(201);
    expect(replayed.body).toEqual(retried.body);
    const thread = await api.request(
      `/v1/conversations/${conversationId}/messages`,
      {
        token,
      },
    );
    expect((thread.body as { items: unknown[] }).items).toHaveLength(2);
  });

  it('denies asking in someone else’s conversation, in any tenant', async () => {
    const conversationId = await newConversation(await fx.memberA.token());
    const body = { content: 'How many days of annual leave?' };

    const sameTenant = await ask(await fx.adminA.token(), conversationId, body);
    const otherTenant = await ask(
      await fx.memberB.token(),
      conversationId,
      body,
    );
    const unknown = await ask(await fx.adminA.token(), randomUUID(), body);
    const outsider = await ask(await fx.outsider.token(), conversationId, body);
    const anonymous = await api.request(
      `/v1/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: json(body),
      },
    );

    expectDeniedWithoutLeak(sameTenant, 404, [conversationId]);
    expectDeniedWithoutLeak(otherTenant, 404, [conversationId]);
    expect(sameTenant.body).toEqual(unknown.body);
    expect(outsider.status).toBe(403);
    expect(anonymous.status).toBe(401);
    expect(generation.requests).toHaveLength(0);
  });
});
