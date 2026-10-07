import { Injectable } from '@nestjs/common';
import { MetricsRegistry } from '@cka/observability';

/**
 * In-process API instruments (E8-T05). Labels are bounded operational values
 * (route templates, status codes, outcomes, reason codes, model names) — never
 * tenant, user or document identifiers, and never question or answer text.
 */
@Injectable()
export class ApiMetrics {
  readonly registry = new MetricsRegistry();

  readonly httpRequests = this.registry.counter(
    'cka_http_requests_total',
    'HTTP requests by method, route template and status code.',
    ['method', 'route', 'status'],
  );
  readonly httpDuration = this.registry.histogram(
    'cka_http_request_duration_seconds',
    'HTTP request duration by method and route template.',
    ['method', 'route'],
  );
  readonly retrievalDuration = this.registry.histogram(
    'cka_rag_retrieval_duration_seconds',
    'Question embedding and vector retrieval duration.',
  );
  readonly generationDuration = this.registry.histogram(
    'cka_rag_generation_duration_seconds',
    'Answer generation (LLM) duration by result.',
    ['result'],
  );
  readonly answers = this.registry.counter(
    'cka_rag_answers_total',
    'Assistant replies by outcome and no-answer reason.',
    ['outcome', 'reason'],
  );
  readonly providerErrors = this.registry.counter(
    'cka_ai_provider_errors_total',
    'AI provider failures by operation and classified error code.',
    ['operation', 'code'],
  );
  readonly providerTokens = this.registry.counter(
    'cka_ai_tokens_total',
    'Generation tokens reported by the provider, by model and kind.',
    ['model', 'kind'],
  );

  recordHttp(
    method: string,
    route: string,
    status: number,
    seconds: number,
  ): void {
    this.httpRequests.inc({ method, route, status: String(status) });
    this.httpDuration.observe({ method, route }, seconds);
  }
}
