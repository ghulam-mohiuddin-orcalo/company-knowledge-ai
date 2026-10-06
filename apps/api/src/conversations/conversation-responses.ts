import type {
  ConversationRecord,
  MessageOutcome,
  MessageRecord,
} from './conversations.repository.js';

export interface ConversationResponse {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageResponse {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  /** Assistant messages only: a grounded answer or the explicit no-answer. */
  outcome: MessageOutcome | null;
  replyTo: string | null;
  createdAt: string;
}

export function toConversationResponse(
  conversation: ConversationRecord,
): ConversationResponse {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

/** Never includes prompts, model/provider details or token usage. */
export function toMessageResponse(message: MessageRecord): MessageResponse {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    outcome: message.outcome,
    replyTo: message.replyToMessageId,
    createdAt: message.createdAt.toISOString(),
  };
}
