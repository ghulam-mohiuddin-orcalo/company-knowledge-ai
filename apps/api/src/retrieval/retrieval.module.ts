import { Module } from '@nestjs/common';
import type { AppConfig, EmbeddingConfig } from '@cka/config';
import { OpenAiCompatibleEmbeddingProvider } from '@cka/ai';
import { APP_CONFIG, EMBEDDING_CONFIG } from '../config/config.module.js';
import {
  EVIDENCE_POLICY,
  ScoreThresholdEvidencePolicy,
} from './evidence-policy.js';
import { RetrievalRepository } from './retrieval.repository.js';
import { EMBEDDING_PROVIDER, RetrievalService } from './retrieval.service.js';

@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      inject: [EMBEDDING_CONFIG],
      useFactory: (config: EmbeddingConfig) =>
        new OpenAiCompatibleEmbeddingProvider(config),
    },
    {
      provide: EVIDENCE_POLICY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new ScoreThresholdEvidencePolicy(config.evidence),
    },
    RetrievalRepository,
    RetrievalService,
  ],
  exports: [
    RetrievalRepository,
    RetrievalService,
    EMBEDDING_PROVIDER,
    EVIDENCE_POLICY,
  ],
})
export class RetrievalModule {}
