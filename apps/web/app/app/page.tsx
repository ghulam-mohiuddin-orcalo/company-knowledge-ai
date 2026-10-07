'use client';

import type {
  ConversationListResponse,
  ConversationResponse,
  DocumentListResponse,
  DocumentResponse,
} from '@cka/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useNewConversation } from '@/components/chat';
import { Alert, describeError, formatDate, Loading } from '@/components/ui';
import { useSession } from '@/lib/session';

const SAMPLE = 100;

/**
 * Dashboard: knowledge readiness and recent conversations, from the existing
 * document and conversation APIs (no analytics backend).
 */
export default function DashboardPage() {
  const { api, me } = useSession();
  const [documents, setDocuments] = useState<DocumentResponse[] | null>(null);
  const [conversations, setConversations] = useState<
    ConversationResponse[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const newConversation = useNewConversation();

  useEffect(() => {
    Promise.all([
      api.request<DocumentListResponse>(`/v1/documents?limit=${SAMPLE}`),
      api.request<ConversationListResponse>('/v1/conversations?limit=5'),
    ])
      .then(([docs, convs]) => {
        setDocuments(docs.items);
        setConversations(convs.items);
      })
      .catch((e: unknown) => setError(describeError(e)));
  }, [api]);

  const count = (statuses: string[]) =>
    documents?.filter((d) => statuses.includes(d.status)).length ?? 0;

  return (
    <>
      <div className="page-header">
        <h1>{me.activeOrganization?.name ?? 'Dashboard'}</h1>
        <button type="button" onClick={() => void newConversation.start()}>
          Ask a question
        </button>
      </div>
      {newConversation.error && <Alert>{newConversation.error}</Alert>}
      {error && <Alert>{error}</Alert>}
      {!error && (!documents || !conversations) && <Loading />}
      {documents && conversations && (
        <>
          <section aria-labelledby="readiness-heading">
            <h2 id="readiness-heading">Knowledge readiness</h2>
            <div className="grid">
              <div className="card">
                <div className="stat">{count(['READY'])}</div>
                <div>Ready to answer questions</div>
              </div>
              <div className="card">
                <div className="stat">{count(['QUEUED', 'PROCESSING'])}</div>
                <div>Processing</div>
              </div>
              <div className="card">
                <div className="stat">{count(['FAILED'])}</div>
                <div>Failed</div>
              </div>
            </div>
            <p className="hint">
              {documents.length === SAMPLE
                ? `Based on the ${SAMPLE} most recent documents. `
                : ''}
              <Link href="/app/documents">View documents</Link>
            </p>
          </section>
          <section aria-labelledby="recent-heading">
            <h2 id="recent-heading">Recent conversations</h2>
            {conversations.length === 0 ? (
              <p>No conversations yet. Ask your first question.</p>
            ) : (
              <ul className="conversation-list card">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <Link href={`/app/chat/${conversation.id}`}>
                      {conversation.title ?? 'New conversation'}
                    </Link>{' '}
                    <span className="hint">
                      {formatDate(conversation.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
