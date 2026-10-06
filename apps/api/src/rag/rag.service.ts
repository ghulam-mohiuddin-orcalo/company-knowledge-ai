import { performance } from 'node:perf_hooks';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { AppConfig } from '@cka/config';
import { AiProviderError, type GenerationProvider } from '@cka/ai';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import {
  ConversationsRepository,
  type MessageRecord,
} from '../conversations/conversations.repository.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import {
  EVIDENCE_POLICY,
  type EvidencePolicy,
} from '../retrieval/evidence-policy.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import type { TenantScope } from '../tenancy/tenant-scope.js';
import { buildRagPrompt, parseAnswer } from './prompt-builder.js';

export const GENERATION_PROVIDER = Symbol('GENERATION_PROVIDER');

/** The explicit no-answer response (BA AC-06, FR-CHAT-04). */
export const NO_ANSWER_MESSAGE =
  'The answer is not available in the current knowledge base.';

export interface AskResult {
  question: MessageRecord;
  answer: MessageRecord;
}

/**
 * RAG orchestration (TDD §13): persist the question, retrieve tenant-scoped
 * evidence, apply the evidence policy, generate only when evidence is
 * sufficient, persist the assistant result. No database transaction is held
 * across provider calls. Logs carry identifiers and outcomes, never text.
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: ConversationsRepository,
    private readonly retrieval: RetrievalService,
    @Inject(EVIDENCE_POLICY) private readonly policy: EvidencePolicy,
    @Inject(GENERATION_PROVIDER)
    private readonly generation: GenerationProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Answers a question in the caller's own conversation. With a request ID,
   * retries return the original exchange (or finish it after a failure)
   * instead of creating duplicates.
   */
  async ask(
    scope: TenantScope,
    userId: string,
    conversationId: string,
    question: string,
    requestId: string | null,
  ): Promise<AskResult> {
    await this.conversations.getOwned(scope, userId, conversationId);
    const { message, created } = await this.messages.insertUserMessage(
      scope,
      conversationId,
      question,
      requestId,
    );
    if (!created) {
      if (message.content !== question) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'This idempotency key was already used for a different question.',
        );
      }
      const existing = await this.messages.findReply(scope, message.id);
      if (existing) return { question: message, answer: existing };
    }
    return { question: message, answer: await this.answer(scope, message) };
  }

  private async answer(
    scope: TenantScope,
    question: MessageRecord,
  ): Promise<MessageRecord> {
    const started = performance.now();
    const context = `conversation ${question.conversationId} message ${question.id} org ${scope.organizationId}`;
    try {
      const hits = await this.retrieval.retrieve(scope, question.content);
      const decision = this.policy.evaluate(question.content, hits);
      if (!decision.sufficient) {
        this.logger.log(
          `No answer (${decision.reason}): ${context} hits ${hits.length}`,
        );
        return this.save(scope, question, {
          content: NO_ANSWER_MESSAGE,
          outcome: 'NO_ANSWER',
          started,
        });
      }

      const prompt = buildRagPrompt(question.content, decision.selectedHits);
      const result = await this.generation.generate({
        system: prompt.system,
        user: prompt.user,
        maxOutputTokens: this.config.ai.maxOutputTokens,
      });
      const parsed = parseAnswer(result.text, prompt.sources);
      this.logger.log(
        `${parsed.kind === 'answer' ? 'Answered' : `No answer (${parsed.reason})`}: ${context} ` +
          `sources ${prompt.sources.length} finish ${result.finishReason}`,
      );
      return this.save(scope, question, {
        content: parsed.kind === 'answer' ? parsed.text : NO_ANSWER_MESSAGE,
        outcome: parsed.kind === 'answer' ? 'ANSWERED' : 'NO_ANSWER',
        started,
        model: result.model,
        usage: result.usage,
      });
    } catch (error) {
      if (error instanceof AiProviderError) {
        this.logger.warn(`AI provider failure (${error.code}): ${context}`);
        throw new ApiError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'AI_PROVIDER_UNAVAILABLE',
          'The assistant is temporarily unavailable. Please try again.',
        );
      }
      throw error;
    }
  }

  private save(
    scope: TenantScope,
    question: MessageRecord,
    reply: {
      content: string;
      outcome: 'ANSWERED' | 'NO_ANSWER';
      started: number;
      model?: string;
      usage?: { inputTokens: number | null; outputTokens: number | null };
    },
  ): Promise<MessageRecord> {
    return this.messages.insertAssistantReply(scope, question.conversationId, {
      replyToMessageId: question.id,
      content: reply.content,
      outcome: reply.outcome,
      model: reply.model ?? null,
      latencyMs: Math.round(performance.now() - reply.started),
      inputTokens: reply.usage?.inputTokens ?? null,
      outputTokens: reply.usage?.outputTokens ?? null,
    });
  }
}
