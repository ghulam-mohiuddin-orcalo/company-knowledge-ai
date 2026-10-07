'use client';

import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { WebConfig } from './config';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Starts the OIDC Authorization Code + PKCE sign-in, returning to `returnTo`. */
  signIn: (returnTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  /** Completes sign-in on the redirect page; returns where to go next. */
  completeSignIn: () => Promise<string>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Only same-origin relative paths are accepted as post-login destinations. */
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//')
    ? value
    : '/app';
}

/**
 * Browser-only OIDC client (public client, PKCE). Tokens are kept in session
 * storage for this tab and sent to the API as bearer tokens; no backend code
 * runs in Next.js.
 */
export function AuthProvider({
  config,
  children,
}: {
  config: WebConfig;
  children: ReactNode;
}) {
  const manager = useMemo(
    () =>
      new UserManager({
        authority: config.oidcAuthority,
        client_id: config.oidcClientId,
        redirect_uri: `${window.location.origin}/auth/callback`,
        post_logout_redirect_uri: `${window.location.origin}/`,
        response_type: 'code',
        scope: config.oidcScope,
        loadUserInfo: false,
        automaticSilentRenew: false,
        userStore: new WebStorageStateStore({ store: window.sessionStorage }),
        extraQueryParams: config.oidcAudience
          ? { audience: config.oidcAudience }
          : undefined,
      }),
    [config],
  );
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let active = true;
    void manager.getUser().then((stored) => {
      if (!active) return;
      const valid = stored && !stored.expired ? stored : null;
      setUser(valid);
      setStatus(valid ? 'authenticated' : 'unauthenticated');
    });
    return () => {
      active = false;
    };
  }, [manager]);

  const signIn = useCallback(
    (returnTo = '/app') =>
      manager.signinRedirect({ state: { returnTo: safeReturnTo(returnTo) } }),
    [manager],
  );

  const signOut = useCallback(async () => {
    await manager.removeUser();
    setUser(null);
    setStatus('unauthenticated');
    try {
      await manager.signoutRedirect();
    } catch {
      window.location.href = new URL('/', window.location.origin).href;
    }
  }, [manager]);

  const getAccessToken = useCallback(async () => {
    const current = await manager.getUser();
    return current && !current.expired ? current.access_token : null;
  }, [manager]);

  const completeSignIn = useCallback(async () => {
    const signedIn = await manager.signinRedirectCallback();
    setUser(signedIn);
    setStatus('authenticated');
    return safeReturnTo(
      (signedIn.state as { returnTo?: unknown } | undefined)?.returnTo,
    );
  }, [manager]);

  const value = useMemo(
    () => ({ status, user, signIn, signOut, getAccessToken, completeSignIn }),
    [status, user, signIn, signOut, getAccessToken, completeSignIn],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}
