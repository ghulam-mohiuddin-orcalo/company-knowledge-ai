'use client';

import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ConversationSidebar, ConversationView } from '@/components/chat';

export default function ConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [refreshKey, setRefreshKey] = useState(0);
  const onAnswered = useCallback(() => setRefreshKey((n) => n + 1), []);
  return (
    <>
      <div className="page-header">
        <h1>Chat</h1>
      </div>
      <div className="chat">
        <ConversationSidebar
          activeId={conversationId}
          refreshKey={refreshKey}
        />
        <ConversationView
          key={conversationId}
          conversationId={conversationId}
          onAnswered={onAnswered}
        />
      </div>
    </>
  );
}
