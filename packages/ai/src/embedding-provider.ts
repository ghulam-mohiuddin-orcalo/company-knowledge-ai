import { AiProviderError, type ProviderErrorCode } from './provider-errors.js';

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

export type EmbeddingErrorCode = ProviderErrorCode;

/** Classified embedding provider failure (see AiProviderError). */
export class EmbeddingProviderError extends AiProviderError {
  constructor(code: ProviderErrorCode, httpStatus?: number) {
    super(code, httpStatus);
    this.name = 'EmbeddingProviderError';
  }
}
