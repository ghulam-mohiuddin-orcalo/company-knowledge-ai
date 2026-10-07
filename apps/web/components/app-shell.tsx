'use client';

import type { MeResponse } from '@cka/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useSession } from '@/lib/session';

interface NavItem {
  href: string;
  label: string;
}

/**
 * Navigation mirrors backend policies (UI hiding is convenience only; the API
 * enforces every rule): tenant pages need an active membership, Organization
 * needs ORG_ADMIN, Platform needs the platform-admin flag.
 */
export function navigationFor(me: MeResponse): NavItem[] {
  const items: NavItem[] = [];
  if (me.activeOrganization) {
    items.push(
      { href: '/app', label: 'Dashboard' },
      { href: '/app/chat', label: 'Chat' },
      { href: '/app/documents', label: 'Documents' },
    );
    if (me.activeOrganization.role === 'ORG_ADMIN') {
      items.push({ href: '/app/organization', label: 'Organization' });
    }
  }
  if (me.user.isPlatformAdmin) {
    items.push({ href: '/app/platform', label: 'Platform' });
  }
  return items;
}

const ROLE_LABELS = {
  MEMBER: 'Member',
  ORG_ADMIN: 'Organization admin',
} as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { me, selectOrganization } = useSession();
  const auth = useAuth();
  const pathname = usePathname();
  const items = navigationFor(me);
  const activeOrganizations = me.organizations.filter(
    (o) => o.status === 'ACTIVE',
  );

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="sidebar">
        <div className="brand">Company Knowledge AI</div>
        {activeOrganizations.length > 1 && (
          <div className="field">
            <label htmlFor="organization-select">Organization</label>
            <select
              id="organization-select"
              value={me.activeOrganization?.id ?? ''}
              onChange={(event) => selectOrganization(event.target.value)}
            >
              {!me.activeOrganization && <option value="">Choose…</option>}
              {activeOrganizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <nav aria-label="Main">
          <ul className="nav">
            {items.map((item) => {
              const current =
                item.href === '/app'
                  ? pathname === '/app'
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="account">
          <span>
            Signed in as <strong>{me.user.displayName ?? me.user.email}</strong>
          </span>
          {me.activeOrganization && (
            <span data-testid="current-role">
              {me.activeOrganization.name} ·{' '}
              {ROLE_LABELS[me.activeOrganization.role]}
            </span>
          )}
          {me.user.isPlatformAdmin && <span>Platform administrator</span>}
          <button
            type="button"
            className="secondary"
            onClick={() => void auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        <TenantGate>{children}</TenantGate>
      </main>
    </div>
  );
}

/** Tenant pages need an active organization; explains why when there is none. */
function TenantGate({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const pathname = usePathname();
  if (me.activeOrganization || pathname.startsWith('/app/platform')) {
    return <>{children}</>;
  }
  const active = me.organizations.filter((o) => o.status === 'ACTIVE');
  if (active.length > 1) {
    return (
      <div className="card">
        <h1>Choose an organization</h1>
        <p>
          You belong to several organizations. Select one in the menu to
          continue.
        </p>
      </div>
    );
  }
  if (me.organizations.some((o) => o.status === 'SUSPENDED')) {
    return (
      <div className="card" role="alert">
        <h1>Organization suspended</h1>
        <p>
          Your organization is currently suspended. Contact your administrator.
        </p>
      </div>
    );
  }
  return (
    <div className="card" role="alert">
      <h1>No organization access</h1>
      <p>
        Your account is not a member of any organization yet. Ask an
        organization administrator to add you.
      </p>
      {me.user.isPlatformAdmin && (
        <p>
          <Link href="/app/platform">Go to platform operations</Link>
        </p>
      )}
    </div>
  );
}
