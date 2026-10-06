/**
 * Embedding provider boundary (TDD §18). Domain code depends on this interface
 * only; vendor request/response formats stay inside adapters.
 */
export interface EmbeddingProvider {
  /** Provider/model identifier stored with vectors for reproducibility. */
  readonly model: string;
  readonly dimensions: number;
  /** One vector per input, in input order. */
  embedTexts(texts: readonly string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export type EmbeddingErrorCode =
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_REJECTED_REQUEST'
  | 'PROVIDER_INVALID_RESPONSE';

const RETRYABLE: ReadonlySet<EmbeddingErrorCode> = new Set([
  'PROVIDER_TIMEOUT',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
]);

/**
 * Classified provider failure. Never carries the API key, input texts or the
 * provider's response body.
 */
export class EmbeddingProviderError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: EmbeddingErrorCode,
    readonly httpStatus?: number,
  ) {
    super(httpStatus ? `${code} (HTTP ${httpStatus})` : code);
    this.name = 'EmbeddingProviderError';
    this.retryable = RETRYABLE.has(code);
  }
}
