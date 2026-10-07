'use client';

import type {
  AskResponse,
  CitationResponse,
  ConversationListResponse,
  ConversationResponse,
  MessageListResponse,
  MessageResponse,
} from '@cka/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { AnswerContent, CitationList } from './answer';
import { SourceDrawer } from './source-drawer';
import { Alert, describeError, Loading } from './ui';

export const QUESTION_MAX_LENGTH = 2000;

/** Starts a conversation and opens it. */
export function useNewConversation() {
  const { api } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setError(null);
    try {
      const conversation = await api.request<ConversationResponse>(
        '/v1/conversations',
        {
          method: 'POST',
          json: {},
        },
      );
      router.push(`/app/chat/${conversation.id}`);
    } catch (e) {
      setError(describeError(e));
    }
  };
  return { start, error };
}

/** The caller's own conversations. */
export function ConversationSidebar({
  activeId,
  refreshKey = 0,
}: {
  activeId?: string;
  /** Changes when the list should reload (e.g. a title was set by a first question). */
  refreshKey?: number;
}) {
  const { api } = useSession();
  const [conversations, setConversations] = useState<
    ConversationResponse[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const newConversation = useNewConversation();

  useEffect(() => {
    api
      .request<ConversationListResponse>('/v1/conversations?limit=50')
      .then((page) => setConversations(page.items))
      .catch((e: unknown) => setError(describeError(e)));
  }, [api, activeId, refreshKey]);

  return (
    <nav aria-label="Conversations" className="card">
      <button type="button" onClick={() => void newConversation.start()}>
        New conversation
      </button>
      {newConversation.error && <Alert>{newConversation.error}</Alert>}
      {error && <Alert>{error}</Alert>}
      {conversations === null && !error && (
        <Loading label="Loading conversations…" />
      )}
      {conversations && conversations.length === 0 && (
        <p className="hint">No conversations yet.</p>
      )}
      {conversations && conversations.length > 0 && (
        <ul className="conversation-list" style={{ marginTop: '0.75rem' }}>
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/app/chat/${conversation.id}`}
                aria-current={conversation.id === activeId ? 'page' : undefined}
              >
                {conversation.title ?? 'New conversation'}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

interface PendingQuestion {
  content: string;
  idempotencyKey: string;
}

/** A conversation thread with the question composer. */
export function ConversationView({
  conversationId,
  onAnswered,
}: {
  conversationId: string;
  /** Called after each answer (the conversation list may need refreshing). */
  onAnswered?: () => void;
}) {
  const { api } = useSession();
  const [messages, setMessages] = useState<MessageResponse[] | null>(null);
  const [loadError, setLoadError] = useState<ApiRequestError | Error | null>(
    null,
  );
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const [failed, setFailed] = useState<{
    question: PendingQuestion;
    message: string;
    retryable: boolean;
  } | null>(null);
  const [openCitation, setOpenCitation] = useState<CitationResponse | null>(
    null,
  );

  // The page remounts this view per conversation (key), so no reset is needed.
  useEffect(() => {
    api
      .request<MessageListResponse>(
        `/v1/conversations/${conversationId}/messages`,
      )
      .then((page) => setMessages(page.items))
      .catch((e: unknown) => setLoadError(e as Error));
  }, [api, conversationId]);

  const send = useCallback(
    async (question: PendingQuestion) => {
      setPending(question);
      setFailed(null);
      try {
        const result = await api.request<AskResponse>(
          `/v1/conversations/${conversationId}/messages`,
          {
            method: 'POST',
            json: { content: question.content },
            // Retrying with the same key can never create a duplicate answer.
            headers: { 'idempotency-key': question.idempotencyKey },
          },
        );
        setMessages((current) => [
          ...(current ?? []),
          result.question,
          result.answer,
        ]);
        setDraft('');
        onAnswered?.();
      } catch (e) {
        const retryable =
          e instanceof ApiRequestError &&
          (e.status >= 500 || e.status === 0 || e.status === 429);
        setFailed({ question, message: describeError(e), retryable });
      } finally {
        setPending(null);
      }
    },
    [api, conversationId, onAnswered],
  );

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || pending) return;
    void send({ content, idempotencyKey: crypto.randomUUID() });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  if (loadError) {
    const notFound =
      loadError instanceof ApiRequestError && loadError.status === 404;
    return (
      <Alert>
        {notFound
          ? 'This conversation could not be found.'
          : describeError(loadError)}
      </Alert>
    );
  }
  if (!messages) return <Loading label="Loading conversation…" />;

  return (
    <section aria-label="Conversation">
      <div className="thread" aria-live="polite">
        {messages.length === 0 && !pending && (
          <p className="hint">
            Ask a question about your organization’s documents.
          </p>
        )}
        {messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            onOpenCitation={setOpenCitation}
          />
        ))}
        {pending && (
          <>
            <div className="message user">{pending.content}</div>
            <div className="message" role="status">
              Searching your organization’s documents…
            </div>
          </>
        )}
      </div>
      {failed && (
        <Alert>
          {failed.message}{' '}
          {failed.retryable && (
            <button
              type="button"
              className="secondary"
              onClick={() => void send(failed.question)}
            >
              Retry
            </button>
          )}
        </Alert>
      )}
      <form className="composer card" onSubmit={submit}>
        <label htmlFor="question">Your question</label>
        <textarea
          id="question"
          value={draft}
          maxLength={QUESTION_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby="question-hint"
          disabled={pending !== null}
        />
        <div className="composer-actions">
          <span id="question-hint" className="hint">
            Enter to send, Shift+Enter for a new line · {draft.length}/
            {QUESTION_MAX_LENGTH}
          </span>
          <button
            type="submit"
            disabled={pending !== null || draft.trim() === ''}
          >
            {pending ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </form>
      {openCitation && (
        <SourceDrawer
          citation={openCitation}
          onClose={() => setOpenCitation(null)}
        />
      )}
    </section>
  );
}

function Message({
  message,
  onOpenCitation,
}: {
  message: MessageResponse;
  onOpenCitation: (citation: CitationResponse) => void;
}) {
  if (message.role === 'USER') {
    return (
      <div className="message user">
        <span className="visually-hidden">You asked: </span>
        {message.content}
      </div>
    );
  }
  if (message.outcome === 'NO_ANSWER') {
    return (
      <div className="message no-answer" data-testid="no-answer">
        <strong>No answer found.</strong> {message.content} Try rephrasing, or
        ask an administrator to upload a document that covers this topic.
      </div>
    );
  }
  return (
    <article className="message" aria-label="Answer">
      <AnswerContent
        content={message.content}
        citations={message.citations}
        onOpen={onOpenCitation}
      />
      <CitationList citations={message.citations} onOpen={onOpenCitation} />
    </article>
  );
}
