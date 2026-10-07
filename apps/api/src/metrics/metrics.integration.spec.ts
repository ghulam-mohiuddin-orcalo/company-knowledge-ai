import {
  AiProviderError,
  FakeGenerationProvider,
  type GenerationProvider,
  type GenerationRequest,
  HashedTermEmbeddingProvider,
} from '@cka/ai';
import {
  type Database,
  EMBEDDING_DIMENSIONS,
  ingestionJobs,
} from '@cka/database';
import { eq, sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';
import { GENERATION_PROVIDER } from '../rag/rag.service.js';
import { EMBEDDING_PROVIDER } from '../retrieval/retrieval.service.js';
import { seedIndexedDocument } from '../testing/chunk-fixtures.js';
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

const METRICS_TOKEN = 'metrics-scrape-token-for-tests';
const SECRET_FACT = 'The Kestrel vault code is 7731-ORCHID.';
const QUESTION = 'What is the Kestrel vault code?';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Value of one sample line, e.g. `metric{a="b"}`. */
function sample(output: string, series: string): number | undefined {
  const line = output.split('\n').find((l) => l.startsWith(`${series} `));
  return line === undefined ? undefined : Number(line.split(' ').at(-1));
}

describe('operational metrics (E8-T05)', () => {
  const embedder = new HashedTermEmbeddingProvider(EMBEDDING_DIMENSIONS);
  let respond: (request: GenerationRequest) => string;
  const generation = new FakeGenerationProvider((r) => respond(r), 'fake-llm');
  // Reports token usage like a real provider does.
  const withUsage: GenerationProvider = {
    model: generation.model,
    generate: async (request) => ({
      ...(await generation.generate(request)),
      usage: { inputTokens: 120, outputTokens: 12 },
    }),
  };
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;
  let database: Database;

  const scrape = () => api.request('/metrics', { token: METRICS_TOKEN });
  const ask = async (question: string) => {
    const token = await fx.memberA.token();
    const conversation = await api.request('/v1/conversations', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const { id } = conversation.body as { id: string };
    return api.request(`/v1/conversations/${id}/messages`, {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: question }),
    });
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(
      db.url,
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
          .useValue(withUsage),
    );
    fx = await seedTenantFixtures(api.app, idp, 'met');
    database = api.app.get<Database>(DATABASE);
    await seedIndexedDocument(
      database,
      { organizationId: fx.orgA.id, uploadedBy: fx.adminA.userId },
      {
        filename: 'Kestrel Secrets.txt',
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

  it('requires the configured bearer token', async () => {
    const missing = await api.request('/metrics');
    const wrong = await api.request('/metrics', { token: 'not-the-token' });
    const member = await api.request('/metrics', {
      token: await fx.memberA.token(),
    });
    const ok = await scrape();

    expect([missing.status, wrong.status, member.status]).toEqual([
      401, 401, 401,
    ]);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toMatch(
      /^text\/plain;.*version=0\.0\.4/,
    );
  });

  it('is disabled (404) unless a token is configured', async () => {
    const disabled = await startTestApi(db.url, idp);
    try {
      const response = await disabled.request('/metrics', {
        token: METRICS_TOKEN,
      });
      expect(response.status).toBe(404);
    } finally {
      await disabled.close();
    }
  });

  it('reports retrieval and generation latency, outcomes, provider usage and failures', async () => {
    respond = () => 'The code is 7731-ORCHID [SOURCE_1].';
    expect((await ask(QUESTION)).status).toBe(201);
    respond = () => 'NO_ANSWER';
    expect((await ask(QUESTION)).status).toBe(201);
    expect((await ask('Who painted the ceiling of the chapel?')).status).toBe(
      201,
    );
    respond = () => {
      throw new AiProviderError('PROVIDER_TIMEOUT');
    };
    expect((await ask(QUESTION)).status).toBe(503);

    const output = (await scrape()).text;

    expect(
      sample(output, 'cka_rag_answers_total{outcome="ANSWERED",reason="NONE"}'),
    ).toBe(1);
    expect(
      output.match(
        /^cka_rag_answers_total\{outcome="NO_ANSWER",reason="[A-Z_]+"\} \d+$/gm,
      ),
    ).toHaveLength(2);
    expect(sample(output, 'cka_rag_retrieval_duration_seconds_count')).toBe(4);
    expect(
      sample(
        output,
        'cka_rag_generation_duration_seconds_count{result="success"}',
      ),
    ).toBe(2);
    expect(
      sample(
        output,
        'cka_rag_generation_duration_seconds_count{result="error"}',
      ),
    ).toBe(1);
    expect(
      sample(
        output,
        'cka_ai_provider_errors_total{operation="generation",code="PROVIDER_TIMEOUT"}',
      ),
    ).toBe(1);
    expect(
      sample(output, 'cka_ai_tokens_total{model="fake-llm",kind="input"}'),
    ).toBe(240);
    expect(
      sample(output, 'cka_ai_tokens_total{model="fake-llm",kind="output"}'),
    ).toBe(24);
    // Database-derived, platform-wide values.
    expect(sample(output, 'cka_metrics_database_up')).toBe(1);
    expect(sample(output, 'cka_answers_24h{outcome="ANSWERED"}')).toBe(1);
    expect(sample(output, 'cka_answers_24h{outcome="NO_ANSWER"}')).toBe(2);
    expect(sample(output, 'cka_no_answer_ratio_24h')).toBeCloseTo(2 / 3);
    expect(
      sample(
        output,
        'cka_generation_tokens_24h{model="fake-llm",kind="input"}',
      ),
    ).toBeGreaterThan(0);
  });

  it('reports ingestion backlog, latency and failures', async () => {
    const form = new FormData();
    form.append('file', new Blob(['queued'], { type: 'text/plain' }), 'q.txt');
    const upload = await api.request('/v1/documents', {
      method: 'POST',
      body: form,
      token: await fx.adminA.token(),
    });
    const documentId = (upload.body as { id: string }).id;
    const failed = new FormData();
    failed.append(
      'file',
      new Blob(['failed'], { type: 'text/plain' }),
      'f.txt',
    );
    const failedId = (
      (
        await api.request('/v1/documents', {
          method: 'POST',
          body: failed,
          token: await fx.adminA.token(),
        })
      ).body as { id: string }
    ).id;
    // As the worker would record it: started 2s before failing.
    await database
      .update(ingestionJobs)
      .set({
        status: 'FAILED',
        errorCode: 'EXTRACTION_EMPTY',
        startedAt: sql`now() - interval '2 seconds'`,
        completedAt: sql`now()`,
      })
      .where(eq(ingestionJobs.documentId, failedId));
    await database
      .update(ingestionJobs)
      .set({
        startedAt: sql`now() - interval '3 seconds'`,
        completedAt: sql`now()`,
        createdAt: sql`now() - interval '5 seconds'`,
      })
      .where(eq(ingestionJobs.status, 'SUCCEEDED'));

    const output = (await scrape()).text;

    expect(documentId).toMatch(UUID);
    expect(sample(output, 'cka_ingestion_jobs{status="QUEUED"}')).toBe(1);
    expect(sample(output, 'cka_ingestion_jobs{status="FAILED"}')).toBe(1);
    expect(sample(output, 'cka_documents{status="QUEUED"}')).toBe(2);
    expect(
      sample(output, 'cka_ingestion_queue_oldest_age_seconds'),
    ).toBeGreaterThanOrEqual(0);
    expect(
      sample(
        output,
        'cka_ingestion_failures_24h{error_code="EXTRACTION_EMPTY"}',
      ),
    ).toBe(1);
    expect(
      sample(output, 'cka_ingestion_jobs_finished_24h{result="SUCCEEDED"}'),
    ).toBe(1);
    expect(
      sample(
        output,
        'cka_ingestion_duration_seconds_24h{kind="processing",quantile="0.5"}',
      ),
    ).toBeCloseTo(3, 0);
    expect(
      sample(
        output,
        'cka_ingestion_duration_seconds_24h{kind="end_to_end",quantile="0.95"}',
      ),
    ).toBeCloseTo(5, 0);
  });

  it('records HTTP traffic by route template and never exposes identifiers or text', async () => {
    await api.request(`/v1/documents/${fx.orgB.id}`, {
      token: await fx.memberA.token(),
    });
    await api.request('/no/such/route');

    const output = (await scrape()).text;

    expect(
      sample(
        output,
        'cka_http_requests_total{method="GET",route="/v1/documents/:documentId",status="404"}',
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      sample(
        output,
        'cka_http_requests_total{method="GET",route="unmatched",status="404"}',
      ),
    ).toBe(1);
    expect(output).not.toMatch(UUID);
    for (const sensitive of [
      SECRET_FACT,
      '7731',
      'Kestrel',
      QUESTION,
      fx.orgA.name,
      fx.memberA.subject,
      METRICS_TOKEN,
      'organization',
    ]) {
      expect(output).not.toContain(sensitive);
    }
  });

  it('counts failed scrape attempts toward the authentication-failure limit', async () => {
    const limited = await startTestApi(db.url, idp, {
      METRICS_TOKEN,
      RATE_LIMIT_AUTH_FAILURES_PER_IP: '2',
    });
    try {
      const statuses: number[] = [];
      for (const token of ['guess-1', 'guess-2', METRICS_TOKEN]) {
        statuses.push((await limited.request('/metrics', { token })).status);
      }
      expect(statuses).toEqual([401, 401, 429]);
    } finally {
      await limited.close();
    }
  });
});
