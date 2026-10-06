import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { type GenerationConfig, Secret } from '@cka/config';
import {
  FakeGenerationProvider,
  GenerationProviderError,
} from './generation-provider.js';
import { OpenAiCompatibleGenerationProvider } from './openai-compatible-generation-provider.js';

const API_KEY = 'sk-generation-key-must-not-leak';

type Reply = {
  status?: number;
  json?: unknown;
  raw?: string;
  delayMs?: number;
};

describe('OpenAiCompatibleGenerationProvider (E5-T02)', () => {
  let server: Server;
  let baseUrl: string;
  let reply: () => Reply;
  const requests: Array<{
    body: Record<string, unknown>;
    auth?: string;
    path?: string;
  }> = [];

  const provider = (overrides: Partial<GenerationConfig> = {}) =>
    new OpenAiCompatibleGenerationProvider({
      provider: 'openai-compatible',
      baseUrl,
      apiKey: new Secret(API_KEY),
      model: 'gpt-test',
      maxOutputTokens: 512,
      requestTimeoutMs: 500,
      ...overrides,
    });
  const request = {
    system: 'TRUSTED SYSTEM RULES',
    user: 'confidential evidence and question',
    maxOutputTokens: 300,
  };

  async function failure(promise: Promise<unknown>) {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GenerationProviderError);
    const printed = `${String(error)} ${inspect(error)} ${JSON.stringify(error)}`;
    for (const secret of [API_KEY, 'confidential', 'TRUSTED SYSTEM RULES']) {
      expect(printed).not.toContain(secret);
    }
    return error as GenerationProviderError;
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        requests.push({
          body: JSON.parse(raw) as Record<string, unknown>,
          auth: req.headers.authorization,
          path: req.url,
        });
        const r = reply();
        setTimeout(() => {
          res.writeHead(r.status ?? 200, {
            'content-type': 'application/json',
          });
          res.end(r.raw ?? JSON.stringify(r.json ?? {}));
        }, r.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    requests.length = 0;
    reply = () => ({
      json: {
        model: 'gpt-test-2026',
        choices: [
          {
            finish_reason: 'stop',
            message: { content: 'Grounded answer [SOURCE_1].' },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 8 },
      },
    });
  });

  it('sends one system and one user message, without tools, and maps usage', async () => {
    const result = await provider().generate(request);

    expect(result).toEqual({
      text: 'Grounded answer [SOURCE_1].',
      model: 'gpt-test-2026',
      finishReason: 'stop',
      usage: { inputTokens: 120, outputTokens: 8 },
    });
    expect(requests[0]).toEqual({
      path: '/v1/chat/completions',
      auth: `Bearer ${API_KEY}`,
      body: {
        model: 'gpt-test',
        messages: [
          { role: 'system', content: 'TRUSTED SYSTEM RULES' },
          { role: 'user', content: 'confidential evidence and question' },
        ],
        max_completion_tokens: 300,
      },
    });
  });

  it('maps finish reasons and empty (refused) content', async () => {
    reply = () => ({
      json: {
        choices: [
          { finish_reason: 'content_filter', message: { content: null } },
        ],
      },
    });

    expect(await provider().generate(request)).toMatchObject({
      text: '',
      model: 'gpt-test',
      finishReason: 'content_filter',
      usage: { inputTokens: null, outputTokens: null },
    });
  });

  it.each([
    [429, 'PROVIDER_RATE_LIMITED', true],
    [503, 'PROVIDER_UNAVAILABLE', true],
    [401, 'PROVIDER_AUTH_FAILED', false],
    [400, 'PROVIDER_REJECTED_REQUEST', false],
  ])(
    'classifies HTTP %i as %s (retryable: %s)',
    async (status, code, retryable) => {
      reply = () => ({
        status,
        json: {
          error: {
            message: `echo: confidential ${API_KEY} TRUSTED SYSTEM RULES`,
          },
        },
      });

      expect(await failure(provider().generate(request))).toMatchObject({
        code,
        retryable,
        httpStatus: status,
      });
    },
  );

  it('times out as retryable', async () => {
    reply = () => ({ json: {}, delayMs: 2000 });

    expect(
      await failure(provider({ requestTimeoutMs: 100 }).generate(request)),
    ).toMatchObject({ code: 'PROVIDER_TIMEOUT', retryable: true });
  });

  it('classifies an unreachable provider as retryable', async () => {
    expect(
      await failure(
        provider({ baseUrl: 'http://127.0.0.1:9/v1' }).generate(request),
      ),
    ).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
  });

  it.each<[string, Reply]>([
    ['malformed JSON', { raw: '{oops' }],
    ['no choices', { json: { choices: [] } }],
    [
      'non-string content',
      { json: { choices: [{ message: { content: 42 } }] } },
    ],
  ])('rejects %s as an invalid response', async (_, invalid) => {
    reply = () => invalid;

    expect(await failure(provider().generate(request))).toMatchObject({
      code: 'PROVIDER_INVALID_RESPONSE',
      retryable: false,
    });
  });
});

describe('FakeGenerationProvider', () => {
  it('answers via the given function and records requests', async () => {
    const fake = new FakeGenerationProvider((r) => `echo ${r.user}`);

    await expect(
      fake.generate({ system: 's', user: 'u', maxOutputTokens: 1 }),
    ).resolves.toMatchObject({ text: 'echo u', model: 'fake-generation' });
    expect(fake.requests).toHaveLength(1);
  });
});
