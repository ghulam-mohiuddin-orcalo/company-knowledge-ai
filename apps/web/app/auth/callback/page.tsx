'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** OIDC redirect target: completes the PKCE code exchange in the browser. */
export default function AuthCallbackPage() {
  const auth = useAuth();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    auth
      .completeSignIn()
      .then((returnTo) => router.replace(returnTo))
      .catch(() => setFailed(true));
  }, [auth, router]);

  if (!failed) return <Loading label="Signing you in…" />;
  return (
    <main className="center-page">
      <div className="card">
        <Alert>Sign-in could not be completed.</Alert>
        <button type="button" onClick={() => void auth.signIn('/app')}>
          Try again
        </button>
      </div>
    </main>
  );
}
