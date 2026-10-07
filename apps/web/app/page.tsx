'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** Sign-in entry point: signed-in users go straight to the app. */
export default function HomePage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === 'authenticated') router.replace('/app');
  }, [auth.status, router]);

  if (auth.status !== 'unauthenticated') return <Loading />;
  return (
    <main className="center-page">
      <div className="card" style={{ maxWidth: '28rem' }}>
        <h1>Company Knowledge AI</h1>
        <p>
          Ask questions about your organization’s documents and get answers with
          sources.
        </p>
        <button type="button" onClick={() => void auth.signIn('/app')}>
          Sign in
        </button>
      </div>
    </main>
  );
}
