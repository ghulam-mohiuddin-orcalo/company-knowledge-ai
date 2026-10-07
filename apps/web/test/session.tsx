import type { MeResponse } from '@cka/contracts';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ApiClient } from '@/lib/api-client';
import { SessionTestProvider } from '@/lib/session';

export function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    user: {
      id: 'u1',
      email: 'u@example.test',
      displayName: 'User',
      isPlatformAdmin: false,
    },
    activeOrganization: {
      id: 'o1',
      name: 'Acme',
      membershipId: 'm1',
      role: 'MEMBER',
    },
    organizations: [
      { id: 'o1', name: 'Acme', role: 'MEMBER', status: 'ACTIVE' },
    ],
    ...overrides,
  };
}

/** Renders inside a session whose API answers with `routes[path]` (or throws it). */
export function renderWithSession(
  ui: ReactNode,
  options: {
    role?: 'MEMBER' | 'ORG_ADMIN';
    routes?: Record<string, unknown>;
  } = {},
) {
  const role = options.role ?? 'MEMBER';
  const request = vi.fn<
    (
      path: string,
      options?: { method?: string; body?: unknown },
    ) => Promise<unknown>
  >(async (path: string) => {
    const key = Object.keys(options.routes ?? {}).find((p) =>
      path.startsWith(p),
    );
    const value = key ? options.routes![key] : undefined;
    if (value instanceof Error) throw value;
    return value;
  });
  const api = { request, download: vi.fn() } as unknown as ApiClient;
  const session = {
    api,
    me: me({
      activeOrganization: { id: 'o1', name: 'Acme', membershipId: 'm1', role },
    }),
    role,
    isAdmin: role === 'ORG_ADMIN',
    selectOrganization: vi.fn(),
  };
  return {
    request,
    ...render(<SessionTestProvider value={session}>{ui}</SessionTestProvider>),
  };
}
