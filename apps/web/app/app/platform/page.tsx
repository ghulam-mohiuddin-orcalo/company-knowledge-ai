'use client';

import type { PlatformOrganizationResponse } from '@cka/contracts';
import { useEffect, useState } from 'react';
import { Alert, describeError, formatDate, Loading } from '@/components/ui';
import { useSession } from '@/lib/session';

/** Platform operations: organizations and status (platform admins; enforced by the API). */
export default function PlatformPage() {
  const { api, me } = useSession();
  const [organizations, setOrganizations] = useState<
    PlatformOrganizationResponse[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me.user.isPlatformAdmin) return;
    api
      .request<PlatformOrganizationResponse[]>('/v1/platform/organizations')
      .then(setOrganizations)
      .catch((e: unknown) => setError(describeError(e)));
  }, [api, me.user.isPlatformAdmin]);

  if (!me.user.isPlatformAdmin) {
    return <Alert>Only platform administrators can view this page.</Alert>;
  }
  return (
    <>
      <div className="page-header">
        <h1>Platform operations</h1>
      </div>
      {error && <Alert>{error}</Alert>}
      {!organizations && !error && <Loading label="Loading organizations…" />}
      {organizations && (
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">Organizations</caption>
            <thead>
              <tr>
                <th scope="col">Organization</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((organization) => (
                <tr key={organization.id}>
                  <td>{organization.name}</td>
                  <td>
                    {organization.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                  </td>
                  <td>{formatDate(organization.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
