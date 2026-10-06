import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { AppConfig } from '@cka/config';
import { Authorize } from '../authorization/authorize.decorator.js';
import { ApiError } from '../common/api-error.js';
import { readJsonObject } from '../common/request-body.js';
import { APP_CONFIG } from '../config/config.module.js';
import {
  type MessageResponse,
  toMessageResponse,
} from '../conversations/conversation-responses.js';
import { CurrentPrincipal, type Principal } from '../tenancy/principal.js';
import { TenantScope } from '../tenancy/tenant-scope.js';
import { RagService } from './rag.service.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,100}$/;

export interface AskResponse {
  question: MessageResponse;
  answer: MessageResponse;
}

const invalid = (message: string) =>
  new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', message);

/**
 * Ask API (E5-T05): persists the question and returns the grounded answer or
 * the explicit no-answer. Send an `Idempotency-Key` header to retry safely.
 */
@Controller('v1/conversations')
export class AskController {
  constructor(
    private readonly rag: RagService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post(':conversationId/messages')
  @Authorize('MEMBER')
  @HttpCode(HttpStatus.CREATED)
  async ask(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<AskResponse> {
    const fields = readJsonObject(body, ['content']);
    if (typeof fields.content !== 'string') {
      throw invalid('content must be a string.');
    }
    const question = fields.content.trim();
    const max = this.config.chat.questionMaxChars;
    if (question === '' || question.length > max) {
      throw invalid(`content must be 1-${max} characters.`);
    }
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw invalid(
        'Idempotency-Key must be 1-100 letters, digits, "-" or "_".',
      );
    }

    const result = await this.rag.ask(
      TenantScope.fromPrincipal(principal),
      principal.userId,
      conversationId,
      question,
      idempotencyKey ?? null,
    );
    return {
      question: toMessageResponse(result.question),
      answer: toMessageResponse(result.answer),
    };
  }
}
