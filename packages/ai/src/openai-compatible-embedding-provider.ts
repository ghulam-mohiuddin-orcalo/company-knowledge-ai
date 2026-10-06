import type { EmbeddingConfig } from '@cka/config';
import {
  EmbeddingProviderError,
  type EmbeddingProvider,
} from './embedding-provider.js';

interface EmbeddingsResponse {
  data?: Array<{ index?: unknown; embedding?: unknown }>;
}

/**
 * Adapter for the OpenAI embeddings HTTP API (`POST {baseUrl}/embeddings`),
 * also served by Azure OpenAI and compatible servers. Inputs are sent in
 * bounded batches with a per-request timeout; failures are classified.
 */
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;

  constructor(private readonly config: EmbeddingConfig) {
    this.model = config.model;
    this.dimensions = config.dimensions;
  }

  async embedTexts(texts: readonly string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += this.config.batchSize) {
      vectors.push(
        ...(await this.request(texts.slice(i, i + this.config.batchSize))),
      );
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.request([text]);
    return vector!;
  }

  private async request(input: readonly string[]): Promise<number[][]> {
    let response: Response;
    try {
      response = await fetch(
        `${this.config.baseUrl.replace(/\/+$/, '')}/embeddings`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.config.apiKey
              ? { authorization: `Bearer ${this.config.apiKey.reveal()}` }
              : {}),
          },
          body: JSON.stringify({
            model: this.config.model,
            input,
            encoding_format: 'float',
            // Only text-embedding-3 models accept a requested dimension.
            ...(this.config.model.startsWith('text-embedding-3')
              ? { dimensions: this.config.dimensions }
              : {}),
          }),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        },
      );
    } catch (error) {
      throw new EmbeddingProviderError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'PROVIDER_TIMEOUT'
          : 'PROVIDER_UNAVAILABLE',
      );
    }

    if (!response.ok) {
      // The body is discarded: it may echo inputs or account details.
      await response.body?.cancel();
      throw new EmbeddingProviderError(
        classifyStatus(response.status),
        response.status,
      );
    }

    let body: EmbeddingsResponse;
    try {
      body = (await response.json()) as EmbeddingsResponse;
    } catch {
      throw new EmbeddingProviderError('PROVIDER_INVALID_RESPONSE');
    }
    return this.parse(body, input.length);
  }

  private parse(body: EmbeddingsResponse, expected: number): number[][] {
    const vectors: number[][] = new Array<number[]>(expected);
    if (!Array.isArray(body.data) || body.data.length !== expected) {
      throw new EmbeddingProviderError('PROVIDER_INVALID_RESPONSE');
    }
    for (const item of body.data) {
      const { index, embedding } = item;
      if (
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= expected ||
        vectors[index] !== undefined ||
        !Array.isArray(embedding) ||
        embedding.length !== this.dimensions ||
        !embedding.every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        throw new EmbeddingProviderError('PROVIDER_INVALID_RESPONSE');
      }
      vectors[index] = embedding as number[];
    }
    return vectors;
  }
}

function classifyStatus(status: number) {
  if (status === 401 || status === 403) return 'PROVIDER_AUTH_FAILED' as const;
  if (status === 408) return 'PROVIDER_TIMEOUT' as const;
  if (status === 429) return 'PROVIDER_RATE_LIMITED' as const;
  if (status >= 500) return 'PROVIDER_UNAVAILABLE' as const;
  return 'PROVIDER_REJECTED_REQUEST' as const;
}
