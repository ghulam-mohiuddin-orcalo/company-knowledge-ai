import { randomUUID } from 'node:crypto';
import { startTestApi, type TestApi } from '../testing/test-api.js';
import {
  expectDeniedWithoutLeak,
  expectNoLeak,
} from '../testing/tenant-boundary.js';
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
import { TenantScope } from '../tenancy/tenant-scope.js';
import { ConversationsRepository } from './conversations.repository.js';

describe('conversations and messages (E5-T01)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;
  let repository: ConversationsRepository;

  const create = async (token: string, body?: unknown) =>
    api.request('/v1/conversations', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const idOf = (response: { body: unknown }) =>
    (response.body as { id: string }).id;

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp);
    fx = await seedTenantFixtures(api.app, idp, 'conv');
    repository = api.app.get(ConversationsRepository);
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  it('creates own conversations, with or without a title', async () => {
    const token = await fx.memberA.token();
    const titled = await create(token, { title: '  Leave questions ' });
    const untitled = await create(token);

    expect(titled.status).toBe(201);
    expect(titled.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      title: 'Leave questions',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(untitled.status).toBe(201);
    expect(untitled.body).toMatchObject({ title: null });
  });

  it.each([
    ['a client-supplied organizationId', { organizationId: 'x' }],
    ['a client-supplied userId', { title: 't', userId: 'x' }],
    ['a non-string title', { title: 42 }],
    ['an overlong title', { title: 'x'.repeat(201) }],
    ['a JSON array', [1]],
  ])('rejects %s', async (_, body) => {
    const response = await create(await fx.memberA.token(), body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('rejects malformed JSON safely', async () => {
    const response = await api.request('/v1/conversations', {
      method: 'POST',
      token: await fx.memberA.token(),
      headers: { 'content-type': 'application/json' },
      body: '{"title":',
    });

    expect(response.status).toBe(400);
    expect(response.text).not.toMatch(/SyntaxError|at JSON/);
  });

  it('lists only the caller’s own conversations, most recent first, with paging', async () => {
    const adminA = await fx.adminA.token();
    const own = [
      idOf(await create(adminA, { title: 'first' })),
      idOf(await create(adminA, { title: 'second' })),
      idOf(await create(adminA, { title: 'third' })),
    ];
    const memberConversation = idOf(
      await create(await fx.memberA.token(), { title: 'member private' }),
    );

    const page1 = await api.request('/v1/conversations?limit=2', {
      token: adminA,
    });
    const { items, nextCursor } = page1.body as {
      items: { id: string }[];
      nextCursor: string;
    };
    const page2 = await api.request(
      `/v1/conversations?limit=2&cursor=${nextCursor}`,
      {
        token: adminA,
      },
    );

    expect(items.map((c) => c.id)).toEqual([own[2], own[1]]);
    expect(
      (page2.body as { items: { id: string }[] }).items.map((c) => c.id),
    ).toEqual([own[0]]);
    expectNoLeak(page1, [memberConversation, 'member private']);
  });

  it('returns the owner’s messages in order, without internal fields', async () => {
    const token = await fx.memberA.token();
    const conversationId = idOf(await create(token));
    const scope = TenantScope.forSystem(fx.orgA.id);
    const { message: question } = await repository.insertUserMessage(
      scope,
      conversationId,
      'How much leave do I get?',
      null,
    );
    await repository.insertAssistantReply(scope, conversationId, {
      replyToMessageId: question.id,
      content: 'The answer is not available in the current knowledge base.',
      outcome: 'NO_ANSWER',
      model: 'secret-model-name',
      latencyMs: 5,
      inputTokens: 10,
      outputTokens: 2,
    });

    const response = await api.request(
      `/v1/conversations/${conversationId}/messages`,
      { token },
    );

    expect(response.status).toBe(200);
    expect((response.body as { items: unknown[] }).items).toEqual([
      {
        id: question.id,
        role: 'USER',
        content: 'How much leave do I get?',
        outcome: null,
        replyTo: null,
        createdAt: expect.any(String),
      },
      {
        id: expect.any(String),
        role: 'ASSISTANT',
        content: 'The answer is not available in the current knowledge base.',
        outcome: 'NO_ANSWER',
        replyTo: question.id,
        createdAt: expect.any(String),
      },
    ]);
    expect(response.text).not.toMatch(/secret-model-name|Tokens|latency/);
    // The first question became the title.
    const list = await api.request('/v1/conversations', { token });
    expect(list.text).toContain('How much leave do I get?');
  });

  it('denies other users of the same organization (IDOR) like unknown IDs', async () => {
    const conversationId = idOf(
      await create(await fx.memberA.token(), { title: 'private notes' }),
    );
    const adminA = await fx.adminA.token();

    const other = await api.request(
      `/v1/conversations/${conversationId}/messages`,
      {
        token: adminA,
      },
    );
    const unknown = await api.request(
      `/v1/conversations/${randomUUID()}/messages`,
      {
        token: adminA,
      },
    );

    expectDeniedWithoutLeak(other, 404, ['private notes', conversationId]);
    expect(other.body).toEqual(unknown.body);
  });

  it('denies other tenants (IDOR), including via tenant selection', async () => {
    const conversationId = idOf(
      await create(await fx.memberA.token(), { title: 'org a secret' }),
    );

    const orgB = await api.request(
      `/v1/conversations/${conversationId}/messages`,
      {
        token: await fx.memberB.token(),
      },
    );
    const viaHeader = await api.request(
      `/v1/conversations/${conversationId}/messages`,
      {
        token: await fx.memberA.token(),
        headers: { 'x-organization-id': fx.orgB.id },
      },
    );
    const outsider = await api.request('/v1/conversations', {
      token: await fx.outsider.token(),
    });

    expectDeniedWithoutLeak(orgB, 404, ['org a secret', conversationId]);
    expect(viaHeader.status).toBe(403);
    expect(outsider.status).toBe(403);
  });

  it('deduplicates retried questions and stores one reply per question', async () => {
    const conversationId = idOf(await create(await fx.memberA.token()));
    const scope = TenantScope.forSystem(fx.orgA.id);

    const first = await repository.insertUserMessage(
      scope,
      conversationId,
      'Q',
      'req-1',
    );
    const retry = await repository.insertUserMessage(
      scope,
      conversationId,
      'Q',
      'req-1',
    );
    const reply = {
      replyToMessageId: first.message.id,
      content: 'A',
      outcome: 'ANSWERED' as const,
      model: 'm',
      latencyMs: 1,
      inputTokens: null,
      outputTokens: null,
    };
    const answer1 = await repository.insertAssistantReply(
      scope,
      conversationId,
      reply,
    );
    const answer2 = await repository.insertAssistantReply(
      scope,
      conversationId,
      {
        ...reply,
        content: 'B',
      },
    );

    expect(first.created).toBe(true);
    expect(retry).toEqual({ message: first.message, created: false });
    expect(answer2).toEqual(answer1);
    expect(await repository.listMessages(scope, conversationId)).toHaveLength(
      2,
    );
  });
});
