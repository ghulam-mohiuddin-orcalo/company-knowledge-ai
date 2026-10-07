'use client';

import { ConversationSidebar } from '@/components/chat';

export default function ChatPage() {
  return (
    <>
      <div className="page-header">
        <h1>Chat</h1>
      </div>
      <div className="chat">
        <ConversationSidebar />
        <p className="card">
          Start a new conversation or open an existing one.
        </p>
      </div>
    </>
  );
}
