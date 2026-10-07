import type { GenerationConfig } from '@cka/config';
import {
  type GenerationProvider,
  GenerationProviderError,
  type GenerationRequest,
  type GenerationResult,
} from './generation-provider.js';
import { classifyFetchFailure, classifyHttpStatus } from './provider-errors.js';

interface ChatCompletionResponse {
  model?: unknown;
  choices?: Array<{
    finish_reason?: unknown;
    message?: { content?: unknown };
  }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

const FINISH_REASONS: Record<string, GenerationResult['finishReason']> = {
  stop: 'stop',
  length: 'length',
  content_filter: 'content_filter',
};

/**
 * Adapter for the OpenAI Chat Completions HTTP API (`POST {baseUrl}/chat/completions`),
 * also served by Azure OpenAI and compatible servers. One system and one user
 * message; no tools/functions are ever offered to the model.
 */
export class OpenAiCompatibleGenerationProvider implements GenerationProvider {
  readonly model: string;

  constructor(private readonly config: GenerationConfig) {
    this.model = config.model;
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    let response: Response;
    try {
      response = await fetch(
        `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`,
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
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            max_completion_tokens: request.maxOutputTokens,
          }),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        },
      );
    } catch (error) {
      throw new GenerationProviderError(classifyFetchFailure(error));
    }

    if (!response.ok) {
      // The body is discarded: it may echo the prompt or account details.
      await response.body?.cancel();
      throw new GenerationProviderError(
        classifyHttpStatus(response.status),
        response.status,
      );
    }

    let body: ChatCompletionResponse;
    try {
      body = (await response.json()) as ChatCompletionResponse;
    } catch {
      throw new GenerationProviderError('PROVIDER_INVALID_RESPONSE');
    }
    const choice = body.choices?.[0];
    const content = choice?.message?.content;
    if (!choice || (content !== null && typeof content !== 'string')) {
      throw new GenerationProviderError('PROVIDER_INVALID_RESPONSE');
    }
    const count = (value: unknown) =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0
        ? value
        : null;
    return {
      // A refusal or filtered reply has no content.
      text: typeof content === 'string' ? content : '',
      model: typeof body.model === 'string' ? body.model : this.config.model,
      finishReason: FINISH_REASONS[String(choice.finish_reason)] ?? 'other',
      usage: {
        inputTokens: count(body.usage?.prompt_tokens),
        outputTokens: count(body.usage?.completion_tokens),
      },
    };
  }
}
