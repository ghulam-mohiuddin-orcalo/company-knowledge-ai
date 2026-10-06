import { Inject, Injectable } from '@nestjs/common';
import { conversations, type Database, messages } from '@cka/database';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../common/database-errors.js';
import { DATABASE } from '../database/database.module.js';
import type { TenantScope } from '../tenancy/tenant-scope.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type ConversationRecord = typeof conversations.$inferSelect;
export type MessageRecord = typeof messages.$inferSelect;
export type MessageOutcome = NonNullable<MessageRecord['outcome']>;

export interface NewAssistantMessage {
  replyToMessageId: string;
  content: string;
  outcome: MessageOutcome;
  model: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Most messages returned for one conversation (oldest of these first). */
export const MAX_MESSAGES = 500;

/**
 * Conversations are tenant-owned and private to their owner (BA FR-CHAT-06):
 * every lookup is scoped by organization and owning user. Another user's or
 * tenant's conversation behaves exactly like an unknown one.
 */
@Injectable()
export class ConversationsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    scope: TenantScope,
    userId: string,
    title: string | null,
  ): Promise<ConversationRecord> {
    const [conversation] = await this.db
      .insert(conversations)
      .values({ organizationId: scope.organizationId, userId, title })
      .returning();
    return conversation!;
  }

  async findOwnedById(
    scope: TenantScope,
    userId: string,
    conversationId: string,
  ): Promise<ConversationRecord | undefined> {
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, scope.organizationId),
          eq(conversations.userId, userId),
          eq(conversations.id, conversationId),
        ),
      );
    return conversation;
  }

  /** Most recently active first; keyset pagination on (updated_at, id). */
  async listOwned(
    scope: TenantScope,
    userId: string,
    page: { limit: number; after?: { createdAt: Date; id: string } },
  ): Promise<ConversationRecord[]> {
    const after = page.after;
    return this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, scope.organizationId),
          eq(conversations.userId, userId),
          after
            ? or(
                lt(conversations.updatedAt, after.createdAt),
                and(
                  eq(conversations.updatedAt, after.createdAt),
                  lt(conversations.id, after.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(page.limit);
  }

  /** Messages of a conversation already authorized by the caller. */
  async listMessages(
    scope: TenantScope,
    conversationId: string,
  ): Promise<MessageRecord[]> {
    const latest = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, scope.organizationId),
          eq(messages.conversationId, conversationId),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(MAX_MESSAGES);
    return latest.reverse();
  }

  /**
   * Inserts a user message. With a request ID, a retry returns the original
   * message instead of creating a duplicate (`created: false`).
   */
  async insertUserMessage(
    scope: TenantScope,
    conversationId: string,
    content: string,
    requestId: string | null,
  ): Promise<{ message: MessageRecord; created: boolean }> {
    try {
      const message = await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(messages)
          .values({
            organizationId: scope.organizationId,
            conversationId,
            role: 'USER',
            content,
            requestId,
          })
          .returning();
        // First question becomes the title; activity bumps the conversation.
        await tx
          .update(conversations)
          .set({
            updatedAt: new Date(),
            title: sql`coalesce(${conversations.title}, ${content.slice(0, 80)})`,
          })
          .where(
            and(
              eq(conversations.organizationId, scope.organizationId),
              eq(conversations.id, conversationId),
            ),
          );
        return inserted!;
      });
      return { message, created: true };
    } catch (error) {
      if (
        requestId &&
        isUniqueViolation(error, 'messages_conversation_id_request_id_key')
      ) {
        const [existing] = await this.db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.organizationId, scope.organizationId),
              eq(messages.conversationId, conversationId),
              eq(messages.requestId, requestId),
            ),
          );
        return { message: existing!, created: false };
      }
      throw error;
    }
  }

  async findReply(
    scope: TenantScope,
    userMessageId: string,
  ): Promise<MessageRecord | undefined> {
    const [reply] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, scope.organizationId),
          eq(messages.replyToMessageId, userMessageId),
        ),
      );
    return reply;
  }

  /**
   * Stores the assistant reply. If a concurrent retry already answered the same
   * question, that reply is returned instead (one reply per question).
   */
  async insertAssistantReply(
    scope: TenantScope,
    conversationId: string,
    reply: NewAssistantMessage,
    /** Runs in the same transaction (e.g. to create citations). */
    withinTransaction?: (tx: Tx, messageId: string) => Promise<void>,
  ): Promise<MessageRecord> {
    try {
      return await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(messages)
          .values({
            ...reply,
            organizationId: scope.organizationId,
            conversationId,
            role: 'ASSISTANT',
          })
          .returning();
        await withinTransaction?.(tx, inserted!.id);
        return inserted!;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'messages_reply_to_message_id_key')) {
        return (await this.findReply(scope, reply.replyToMessageId))!;
      }
      throw error;
    }
  }
}
