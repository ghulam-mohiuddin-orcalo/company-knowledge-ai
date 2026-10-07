import type { ErrorEnvelope } from '@cka/contracts';

/** A failed API call, carrying the server's safe error code and message. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  /** The organization selected in the UI; verified server-side against memberships. */
  getOrganizationId: () => string | null;
  onUnauthenticated: () => void;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  json?: unknown;
  body?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Thin typed client for the NestJS API. All authorization happens server-side. */
export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Downloads a binary response (e.g. a cited original document). */
  async download(
    path: string,
  ): Promise<{ blob: Blob; filename: string | null }> {
    const response = await this.send(path, {});
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    return {
      blob: await response.blob(),
      filename: match ? decodeURIComponent(match[1]!) : null,
    };
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const token = await this.options.getAccessToken();
    const organizationId = this.options.getOrganizationId();
    const headers: Record<string, string> = { ...options.headers };
    if (token) headers.authorization = `Bearer ${token}`;
    if (organizationId) headers['x-organization-id'] = organizationId;
    let body: BodyInit | undefined = options.body;
    if (options.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.json);
    }

    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError')
        throw error;
      throw new ApiRequestError(
        0,
        'NETWORK_ERROR',
        'The service could not be reached. Check your connection and try again.',
      );
    }
    if (response.ok) return response;

    let envelope: Partial<ErrorEnvelope> = {};
    try {
      envelope = (await response.json()) as ErrorEnvelope;
    } catch {
      // Non-JSON error body: fall back to a generic message.
    }
    const error = new ApiRequestError(
      response.status,
      envelope.error?.code ?? 'UNKNOWN_ERROR',
      envelope.error?.message ?? 'Something went wrong. Please try again.',
      envelope.error?.requestId ??
        response.headers.get('x-request-id') ??
        undefined,
    );
    if (response.status === 401) this.options.onUnauthenticated();
    throw error;
  }
}
