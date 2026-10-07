import { Injectable } from '@nestjs/common';
import {
  type CitationView,
  CitationsRepository,
} from '../citations/citations.repository.js';
import { ApiError } from '../common/api-error.js';
import { encodeCursor, type PageRequest } from '../common/pagination.js';
import type { TenantScope } from '../tenancy/tenant-scope.js';
import {
  type ConversationRecord,
  ConversationsRepository,
  type MessageRecord,
} from './conversations.repository.js';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly citations: CitationsRepository,
  ) {}

  async create(
    scope: TenantScope,
    userId: string,
    title: string | undefined,
  ): Promise<ConversationRecord> {
    return this.conversations.create(scope, userId, title ?? null);
  }

  async list(
    scope: TenantScope,
    userId: string,
    page: PageRequest,
  ): Promise<{ items: ConversationRecord[]; nextCursor: string | null }> {
    const rows = await this.conversations.listOwned(scope, userId, {
      limit: page.limit + 1,
      after: page.after,
    });
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor({ createdAt: last.updatedAt, id: last.id })
          : null,
    };
  }

  /** The caller's own conversation; anything else is indistinguishable from unknown (404). */
  async getOwned(
    scope: TenantScope,
    userId: string,
    conversationId: string,
  ): Promise<ConversationRecord> {
    const conversation = await this.conversations.findOwnedById(
      scope,
      userId,
      conversationId,
    );
    if (!conversation) throw ApiError.notFound();
    return conversation;
  }

  async listMessages(
    scope: TenantScope,
    userId: string,
    conversationId: string,
  ): Promise<{ messages: MessageRecord[]; citations: CitationView[] }> {
    await this.getOwned(scope, userId, conversationId);
    const messages = await this.conversations.listMessages(
      scope,
      conversationId,
    );
    const citations = await this.citations.listForMessages(
      scope,
      messages.filter((m) => m.role === 'ASSISTANT').map((m) => m.id),
    );
    return { messages, citations };
  }
}
