import {
  type CitationResponse,
  toCitationResponse,
} from '../citations/citation-responses.js';
import type { CitationView } from '../citations/citations.repository.js';
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
  /** Server-backed citations, in ordinal order (assistant answers only). */
  citations: CitationResponse[];
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
export function toMessageResponse(
  message: MessageRecord,
  citations: readonly CitationView[] = [],
): MessageResponse {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    outcome: message.outcome,
    replyTo: message.replyToMessageId,
    citations: citations
      .filter((citation) => citation.messageId === message.id)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(toCitationResponse),
    createdAt: message.createdAt.toISOString(),
  };
}
