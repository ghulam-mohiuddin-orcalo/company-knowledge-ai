'use client';

import type { MeResponse, MembershipRole } from '@cka/contracts';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiClient, ApiRequestError } from './api-client';
import { useAuth } from './auth';
import type { WebConfig } from './config';
import {
  getSelectedOrganization,
  setSelectedOrganization,
} from './organization-selection';

export interface SessionState {
  api: ApiClient;
  me: MeResponse;
  /** Role in the active organization (null without one). */
  role: MembershipRole | null;
  isAdmin: boolean;
  selectOrganization: (organizationId: string) => void;
}

const SessionContext = createContext<SessionState | null>(null);

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; me: MeResponse }
  | { status: 'error'; error: ApiRequestError };

/**
 * Loads the signed-in user and active organization from GET /v1/me. The
 * selected organization is only a hint: the API checks it against the user's
 * memberships on every request.
 */
export function SessionProvider({
  config,
  children,
  fallback,
  renderError,
}: {
  config: WebConfig;
  children: ReactNode;
  fallback: ReactNode;
  renderError: (error: ApiRequestError, retry: () => void) => ReactNode;
}) {
  const auth = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reload, setReload] = useState(0);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: config.apiUrl,
        getAccessToken: auth.getAccessToken,
        getOrganizationId: getSelectedOrganization,
        onUnauthenticated: () => void auth.signIn(window.location.pathname),
      }),
    [config.apiUrl, auth],
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        let me = await api.request<MeResponse>('/v1/me');
        // Drop a stale selection (e.g. membership removed) and fall back to the default.
        const selected = getSelectedOrganization();
        if (selected && !me.organizations.some((o) => o.id === selected)) {
          setSelectedOrganization(null);
          me = await api.request<MeResponse>('/v1/me');
        }
        if (active) setState({ status: 'ready', me });
      } catch (error) {
        if (!active) return;
        if (
          error instanceof ApiRequestError &&
          error.status === 403 &&
          getSelectedOrganization()
        ) {
          setSelectedOrganization(null);
          setReload((n) => n + 1);
          return;
        }
        setState({
          status: 'error',
          error:
            error instanceof ApiRequestError
              ? error
              : new ApiRequestError(
                  0,
                  'UNKNOWN_ERROR',
                  'Something went wrong.',
                ),
        });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [api, reload]);

  const selectOrganization = useCallback((id: string) => {
    setSelectedOrganization(id);
    setState({ status: 'loading' });
    setReload((n) => n + 1);
  }, []);

  if (state.status === 'loading') return <>{fallback}</>;
  if (state.status === 'error') {
    return <>{renderError(state.error, () => setReload((n) => n + 1))}</>;
  }
  const role = state.me.activeOrganization?.role ?? null;
  return (
    <SessionContext.Provider
      value={{
        api,
        me: state.me,
        role,
        isAdmin: role === 'ORG_ADMIN',
        selectOrganization,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const session = useContext(SessionContext);
  if (!session)
    throw new Error('useSession must be used inside SessionProvider');
  return session;
}

/** For tests: provides a session without loading it. */
export const SessionTestProvider = SessionContext.Provider;
