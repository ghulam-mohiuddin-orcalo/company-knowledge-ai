export type ProviderErrorCode =
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_REJECTED_REQUEST'
  | 'PROVIDER_INVALID_RESPONSE';

const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set([
  'PROVIDER_TIMEOUT',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
]);

/**
 * Classified AI provider failure. Never carries the API key, prompts, input
 * texts or the provider's response body.
 */
export class AiProviderError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: ProviderErrorCode,
    readonly httpStatus?: number,
  ) {
    super(httpStatus ? `${code} (HTTP ${httpStatus})` : code);
    this.name = 'AiProviderError';
    this.retryable = RETRYABLE.has(code);
  }
}

/** Maps an HTTP error status to a classified provider error code. */
export function classifyHttpStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'PROVIDER_AUTH_FAILED';
  if (status === 408) return 'PROVIDER_TIMEOUT';
  if (status === 429) return 'PROVIDER_RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'PROVIDER_REJECTED_REQUEST';
}

/** Maps a fetch failure (timeout or network) to a classified provider error code. */
export function classifyFetchFailure(error: unknown): ProviderErrorCode {
  return error instanceof Error && error.name === 'TimeoutError'
    ? 'PROVIDER_TIMEOUT'
    : 'PROVIDER_UNAVAILABLE';
}
