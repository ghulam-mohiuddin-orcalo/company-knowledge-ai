import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Authorize } from '../authorization/authorize.decorator.js';
import { parsePageRequest } from '../common/pagination.js';
import { readJsonObject, readOptionalString } from '../common/request-body.js';
import { CurrentPrincipal, type Principal } from '../tenancy/principal.js';
import { TenantScope } from '../tenancy/tenant-scope.js';
import {
  type ConversationResponse,
  type MessageResponse,
  toConversationResponse,
  toMessageResponse,
} from './conversation-responses.js';
import { ConversationsService } from './conversations.service.js';

export const CONVERSATION_TITLE_MAX_LENGTH = 200;

/** Own conversations only (BA FR-CHAT-06): members and admins alike. */
@Controller('v1/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Post()
  @Authorize('MEMBER')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ): Promise<ConversationResponse> {
    const fields = readJsonObject(body ?? {}, ['title']);
    const title = readOptionalString(
      fields.title,
      'title',
      CONVERSATION_TITLE_MAX_LENGTH,
    );
    return toConversationResponse(
      await this.conversations.create(
        TenantScope.fromPrincipal(principal),
        principal.userId,
        title,
      ),
    );
  }

  @Get()
  @Authorize('MEMBER')
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: Record<string, unknown>,
  ): Promise<{ items: ConversationResponse[]; nextCursor: string | null }> {
    const page = await this.conversations.list(
      TenantScope.fromPrincipal(principal),
      principal.userId,
      parsePageRequest(query),
    );
    return {
      items: page.items.map(toConversationResponse),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':conversationId/messages')
  @Authorize('MEMBER')
  async messages(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
  ): Promise<{ items: MessageResponse[] }> {
    const messages = await this.conversations.listMessages(
      TenantScope.fromPrincipal(principal),
      principal.userId,
      conversationId,
    );
    return { items: messages.map(toMessageResponse) };
  }
}
