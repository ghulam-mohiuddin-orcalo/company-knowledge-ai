'use client';

import type { OrganizationMemberResponse } from '@cka/contracts';
import { useEffect, useState } from 'react';
import { Alert, describeError, Loading } from '@/components/ui';
import { useSession } from '@/lib/session';

const ROLES = { MEMBER: 'Member', ORG_ADMIN: 'Organization admin' } as const;

/** Organization details and members (ORG_ADMIN; enforced by the API). */
export default function OrganizationPage() {
  const { api, me, isAdmin } = useSession();
  const [members, setMembers] = useState<OrganizationMemberResponse[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .request<OrganizationMemberResponse[]>('/v1/organization/members')
      .then(setMembers)
      .catch((e: unknown) => setError(describeError(e)));
  }, [api, isAdmin]);

  if (!isAdmin)
    return <Alert>Only organization administrators can view this page.</Alert>;
  return (
    <>
      <div className="page-header">
        <h1>{me.activeOrganization?.name}</h1>
      </div>
      {error && <Alert>{error}</Alert>}
      {!members && !error && <Loading label="Loading members…" />}
      {members && (
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">Organization members</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.membershipId}>
                  <td>{member.displayName ?? '—'}</td>
                  <td>{member.email}</td>
                  <td>{ROLES[member.role]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
