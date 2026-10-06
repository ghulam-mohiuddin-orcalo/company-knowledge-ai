import { Module } from '@nestjs/common';
import type { GenerationConfig } from '@cka/config';
import { OpenAiCompatibleGenerationProvider } from '@cka/ai';
import { GENERATION_CONFIG } from '../config/config.module.js';
import { CitationsModule } from '../citations/citations.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { AskController } from './ask.controller.js';
import { GENERATION_PROVIDER, RagService } from './rag.service.js';

@Module({
  imports: [ConversationsModule, RetrievalModule, CitationsModule],
  controllers: [AskController],
  providers: [
    {
      provide: GENERATION_PROVIDER,
      inject: [GENERATION_CONFIG],
      useFactory: (config: GenerationConfig) =>
        new OpenAiCompatibleGenerationProvider(config),
    },
    RagService,
  ],
  exports: [RagService, GENERATION_PROVIDER],
})
export class RagModule {}
