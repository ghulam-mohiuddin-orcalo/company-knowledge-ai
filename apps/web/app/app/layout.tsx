'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useWebConfig } from '../providers';
import { AppShell } from '@/components/app-shell';
import { Alert, describeError, Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { SessionProvider } from '@/lib/session';

/** Authenticated area: unauthenticated users are sent to sign-in, then back here. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const config = useWebConfig();
  const pathname = usePathname();

  useEffect(() => {
    if (auth.status === 'unauthenticated') void auth.signIn(pathname);
  }, [auth, pathname]);

  if (auth.status !== 'authenticated')
    return <Loading label="Redirecting to sign-in…" />;
  return (
    <SessionProvider
      config={config}
      fallback={<Loading label="Loading your workspace…" />}
      renderError={(error, retry) => (
        <main className="center-page">
          <div className="card">
            <Alert>{describeError(error)}</Alert>
            <button type="button" onClick={retry}>
              Try again
            </button>
          </div>
        </main>
      )}
    >
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
