import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { type EmbeddingConfig, Secret } from '@cka/config';
import { DeterministicEmbeddingProvider } from './deterministic-embedding-provider.js';
import { HashedTermEmbeddingProvider } from './hashed-term-embedding-provider.js';
import { EmbeddingProviderError } from './embedding-provider.js';
import { OpenAiCompatibleEmbeddingProvider } from './openai-compatible-embedding-provider.js';

const API_KEY = 'sk-test-key-must-not-leak';
const DIMS = 4;

type Handler = (
  body: { model: string; input: string[]; dimensions?: number },
  request?: IncomingMessage,
) => { status?: number; json?: unknown; raw?: string; delayMs?: number };

describe('OpenAiCompatibleEmbeddingProvider (E3-T04)', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  const requests: Array<{
    body: { input: string[]; model: string; dimensions?: number };
    auth?: string;
  }> = [];

  const vectorFor = (text: string) => [text.length, 1, 2, 3];
  const ok: Handler = (body) => ({
    json: {
      // Deliberately out of order: the adapter must use `index`.
      data: body.input
        .map((text, index) => ({ index, embedding: vectorFor(text) }))
        .reverse(),
    },
  });

  const provider = (overrides: Partial<EmbeddingConfig> = {}) =>
    new OpenAiCompatibleEmbeddingProvider({
      provider: 'openai-compatible',
      baseUrl,
      apiKey: new Secret(API_KEY),
      model: 'text-embedding-3-small',
      dimensions: DIMS,
      batchSize: 2,
      requestTimeoutMs: 500,
      ...overrides,
    });

  async function failure(
    promise: Promise<unknown>,
  ): Promise<EmbeddingProviderError> {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingProviderError);
    const printed = `${String(error)} ${inspect(error)} ${JSON.stringify(error)}`;
    expect(printed).not.toContain(API_KEY);
    expect(printed).not.toContain('confidential');
    return error as EmbeddingProviderError;
  }

  beforeAll(async () => {
    server = createServer((request, response) => {
      let raw = '';
      request.on('data', (c: Buffer) => (raw += c.toString()));
      request.on('end', () => {
        const body = JSON.parse(raw) as { model: string; input: string[] };
        requests.push({ body, auth: request.headers.authorization });
        const result = handler(body, request);
        setTimeout(() => {
          response.writeHead(result.status ?? 200, {
            'content-type': 'application/json',
          });
          response.end(result.raw ?? JSON.stringify(result.json ?? {}));
        }, result.delayMs ?? 0);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  beforeEach(() => {
    requests.length = 0;
    handler = ok;
  });

  it('embeds texts in input order using bounded batches', async () => {
    const vectors = await provider().embedTexts([
      'a',
      'bb',
      'ccc',
      'dddd',
      'eeeee',
    ]);

    expect(vectors).toEqual(['a', 'bb', 'ccc', 'dddd', 'eeeee'].map(vectorFor));
    expect(requests.map((r) => r.body.input)).toEqual([
      ['a', 'bb'],
      ['ccc', 'dddd'],
      ['eeeee'],
    ]);
    expect(requests[0]).toMatchObject({
      auth: `Bearer ${API_KEY}`,
      body: { model: 'text-embedding-3-small', dimensions: DIMS },
    });
  });

  it('embeds a query', async () => {
    await expect(provider().embedQuery('hello')).resolves.toEqual(
      vectorFor('hello'),
    );
  });

  it('makes no request for an empty input list', async () => {
    await expect(provider().embedTexts([])).resolves.toEqual([]);
    expect(requests).toEqual([]);
  });

  it('omits the dimensions parameter for models that do not support it, and the key when unset', async () => {
    await provider({ model: 'nomic-embed-text', apiKey: undefined }).embedTexts(
      ['x'],
    );

    expect(requests[0]!.body).not.toHaveProperty('dimensions');
    expect(requests[0]!.auth).toBeUndefined();
  });

  it.each([
    [429, 'PROVIDER_RATE_LIMITED', true],
    [500, 'PROVIDER_UNAVAILABLE', true],
    [503, 'PROVIDER_UNAVAILABLE', true],
    [401, 'PROVIDER_AUTH_FAILED', false],
    [403, 'PROVIDER_AUTH_FAILED', false],
    [400, 'PROVIDER_REJECTED_REQUEST', false],
  ])(
    'classifies HTTP %i as %s (retryable: %s)',
    async (status, code, retryable) => {
      handler = () => ({
        status,
        json: {
          error: { message: `confidential input echoed, key ${API_KEY}` },
        },
      });

      const error = await failure(provider().embedTexts(['confidential text']));

      expect(error).toMatchObject({ code, retryable, httpStatus: status });
    },
  );

  it('times out slow requests as retryable', async () => {
    handler = (body) => ({ ...ok(body), delayMs: 2000 });

    const error = await failure(
      provider({ requestTimeoutMs: 100 }).embedTexts(['x']),
    );

    expect(error).toMatchObject({ code: 'PROVIDER_TIMEOUT', retryable: true });
  });

  it('classifies an unreachable provider as retryable', async () => {
    const error = await failure(
      provider({ baseUrl: 'http://127.0.0.1:9/v1' }).embedTexts(['x']),
    );

    expect(error).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  it.each<[string, Handler]>([
    ['malformed JSON', () => ({ raw: '{not json' })],
    [
      'a missing vector',
      () => ({ json: { data: [{ index: 0, embedding: [1, 2, 3, 4] }] } }),
    ],
    [
      'the wrong dimension',
      (body) => ({
        json: {
          data: body.input.map((_, index) => ({ index, embedding: [1, 2] })),
        },
      }),
    ],
    [
      'non-finite values',
      (body) => ({
        json: {
          data: body.input.map((_, index) => ({
            index,
            embedding: [1, 2, 3, null],
          })),
        },
      }),
    ],
    [
      'duplicate indexes',
      () => ({
        json: {
          data: [
            { index: 0, embedding: [1, 2, 3, 4] },
            { index: 0, embedding: [1, 2, 3, 4] },
          ],
        },
      }),
    ],
  ])('rejects %s as an invalid response', async (_, invalid) => {
    handler = invalid;

    const error = await failure(
      provider().embedTexts(['confidential a', 'confidential b']),
    );

    expect(error).toMatchObject({
      code: 'PROVIDER_INVALID_RESPONSE',
      retryable: false,
    });
  });
});

describe('DeterministicEmbeddingProvider', () => {
  it('returns stable unit vectors of the configured dimension', async () => {
    const fake = new DeterministicEmbeddingProvider(1536);
    const [a1, b] = await fake.embedTexts(['alpha', 'beta']);
    const a2 = await fake.embedQuery('alpha');

    expect(a1).toHaveLength(1536);
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
    expect(Math.hypot(...a1!)).toBeCloseTo(1, 10);
  });
});

describe('HashedTermEmbeddingProvider', () => {
  const provider = new HashedTermEmbeddingProvider(1536);
  const cosine = (a: number[], b: number[]) =>
    a.reduce((sum, v, i) => sum + v * b[i]!, 0);

  it('scores texts sharing terms above unrelated texts, deterministically', async () => {
    const [question, related, unrelated] = await provider.embedTexts([
      'How many days of annual leave do employees get?',
      'Every employee receives 27 days of paid annual leave per year.',
      'Business mileage is reimbursed at 45 pence per mile.',
    ]);

    expect(cosine(question!, related!)).toBeGreaterThan(
      cosine(question!, unrelated!) + 0.2,
    );
    expect(await provider.embedQuery('Annual leave')).toEqual(
      provider.vector('Annual leave'),
    );
    expect(Math.hypot(...question!)).toBeCloseTo(1, 10);
  });

  it('returns a zero vector for text without terms', () => {
    expect(provider.vector('the of and ?!').every((v) => v === 0)).toBe(true);
  });
});
