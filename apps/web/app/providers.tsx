'use client';

import { type ReactNode, useMemo, useSyncExternalStore } from 'react';
import { AuthProvider } from '@/lib/auth';
import { readWebConfig, type WebConfig } from '@/lib/config';

const noopSubscribe = () => () => undefined;

/** Client-only root: configuration check and OIDC session. */
export function Providers({ children }: { children: ReactNode }) {
  // The OIDC client needs browser APIs: render nothing during prerendering.
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const config = useMemo(() => readWebConfig(), []);

  if (!isClient) return null;
  if (!config.ok) {
    return (
      <main className="center-page">
        <div className="card" role="alert">
          <h1>Configuration required</h1>
          <p>Set these environment variables for the web app:</p>
          <ul>
            {config.missing.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
        </div>
      </main>
    );
  }
  return <AuthProvider config={config.config}>{children}</AuthProvider>;
}

/** Access to the validated public configuration inside the app. */
export function useWebConfig(): WebConfig {
  const result = readWebConfig();
  if (!result.ok) throw new Error('Web configuration missing');
  return result.config;
}
