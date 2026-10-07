import { AiProviderError, type ProviderErrorCode } from './provider-errors.js';

export interface GenerationRequest {
  /** Trusted instructions. */
  system: string;
  /** User turn: may contain untrusted content, clearly delimited by the caller. */
  user: string;
  maxOutputTokens: number;
}

export interface GenerationResult {
  text: string;
  model: string;
  finishReason: 'stop' | 'length' | 'content_filter' | 'other';
  usage: { inputTokens: number | null; outputTokens: number | null };
}

/**
 * Answer generation boundary (TDD §18). RAG domain code depends on this
 * interface only; vendor request/response formats stay inside adapters.
 */
export interface GenerationProvider {
  readonly model: string;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

/** Classified generation provider failure (see AiProviderError). */
export class GenerationProviderError extends AiProviderError {
  constructor(code: ProviderErrorCode, httpStatus?: number) {
    super(code, httpStatus);
    this.name = 'GenerationProviderError';
  }
}

/** Test double: answers with `respond(request)` and records every request. */
export class FakeGenerationProvider implements GenerationProvider {
  readonly requests: GenerationRequest[] = [];

  constructor(
    private readonly respond: (
      request: GenerationRequest,
    ) => string | Promise<string>,
    readonly model = 'fake-generation',
  ) {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.requests.push(request);
    return {
      text: await this.respond(request),
      model: this.model,
      finishReason: 'stop',
      usage: { inputTokens: null, outputTokens: null },
    };
  }
}
