import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@cka/config';
import type { EmbeddingProvider } from '@cka/ai';
import { APP_CONFIG } from '../config/config.module.js';
import type { TenantScope } from '../tenancy/tenant-scope.js';
import { mergeAndSelect, type RetrievalHit } from './retrieval-hit.js';
import { RetrievalRepository } from './retrieval.repository.js';

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** Normalizes a question for embedding without rewriting its meaning. */
export function normalizeQuery(query: string): string {
  return query
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tenant-scoped semantic retrieval returning bounded, deduplicated evidence. */
@Injectable()
export class RetrievalService {
  constructor(
    private readonly repository: RetrievalRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Throws the provider's classified error if the query cannot be embedded. */
  async retrieve(scope: TenantScope, query: string): Promise<RetrievalHit[]> {
    const normalized = normalizeQuery(query);
    if (normalized === '') return [];
    const vector = await this.embeddings.embedQuery(normalized);
    // A zero vector carries no meaning (cosine similarity is undefined).
    if (vector.every((value) => value === 0)) return [];
    const matches = await this.repository.searchSimilarChunks(
      scope,
      vector,
      this.config.retrieval.candidates,
    );
    return mergeAndSelect(matches, {
      maxHits: this.config.retrieval.maxEvidence,
      maxPerDocument: this.config.retrieval.maxPerDocument,
    });
  }
}
