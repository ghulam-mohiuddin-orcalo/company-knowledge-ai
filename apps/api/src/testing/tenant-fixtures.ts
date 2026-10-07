import type { INestApplication } from '@nestjs/common';
import { type Database, users } from '@cka/database';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';
import type { OrganizationRecord } from '../organizations/organizations.repository.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import type { MembershipRole } from '../tenancy/memberships.repository.js';
import { MembershipsService } from '../tenancy/memberships.service.js';
import { TenantScope } from '../tenancy/tenant-scope.js';
import { UsersService } from '../users/users.service.js';
import type { TestIdentityProvider } from './test-identity-provider.js';

export interface FixtureUser {
  subject: string;
  userId: string;
  /** Membership in the user's home organization, if any. */
  membershipId: string | undefined;
  token(): Promise<string>;
}

/**
 * Two isolated tenants for security tests:
 * - Org A: adminA (ORG_ADMIN), memberA (MEMBER)
 * - Org B: adminB (ORG_ADMIN), memberB (MEMBER)
 * - platformAdmin: platform operator with no membership
 * - outsider: authenticated user with no membership
 * - suspended: MEMBER of a SUSPENDED organization
 */
export interface TenantFixtures {
  orgA: OrganizationRecord;
  orgB: OrganizationRecord;
  suspendedOrg: OrganizationRecord;
  adminA: FixtureUser;
  memberA: FixtureUser;
  adminB: FixtureUser;
  memberB: FixtureUser;
  platformAdmin: FixtureUser;
  outsider: FixtureUser;
  suspended: FixtureUser;
}

/** Seeds Org A/Org B fixtures through the real services. Subjects get `prefix` for uniqueness. */
export async function seedTenantFixtures(
  app: INestApplication,
  idp: TestIdentityProvider,
  prefix = 'fx',
): Promise<TenantFixtures> {
  const organizations = app.get(OrganizationsService);
  const memberships = app.get(MembershipsService);
  const usersService = app.get(UsersService);
  const db = app.get<Database>(DATABASE);

  const user = async (
    name: string,
    membership?: { organizationId: string; role: MembershipRole },
  ): Promise<FixtureUser> => {
    const subject = `${prefix}-${name}`;
    const { userId } = await usersService.resolveVerifiedIdentity({
      subject,
      email: `${subject}@example.test`,
      displayName: name,
    });
    const created = membership
      ? await memberships.addMember(
          TenantScope.forSystem(membership.organizationId),
          userId,
          membership.role,
        )
      : undefined;
    return {
      subject,
      userId,
      membershipId: created?.id,
      token: () =>
        idp.token(subject, { email: `${subject}@example.test`, name }),
    };
  };

  const orgA = await organizations.createOrganization(`${prefix} Org A`);
  const orgB = await organizations.createOrganization(`${prefix} Org B`);
  const suspendedOrg = await organizations.createOrganization(
    `${prefix} Suspended`,
  );
  await organizations.setStatus(suspendedOrg.id, 'SUSPENDED');

  const platformAdmin = await user('platform-admin');
  await db
    .update(users)
    .set({ isPlatformAdmin: true })
    .where(eq(users.id, platformAdmin.userId));

  return {
    orgA,
    orgB,
    suspendedOrg: { ...suspendedOrg, status: 'SUSPENDED' },
    adminA: await user('admin-a', {
      organizationId: orgA.id,
      role: 'ORG_ADMIN',
    }),
    memberA: await user('member-a', {
      organizationId: orgA.id,
      role: 'MEMBER',
    }),
    adminB: await user('admin-b', {
      organizationId: orgB.id,
      role: 'ORG_ADMIN',
    }),
    memberB: await user('member-b', {
      organizationId: orgB.id,
      role: 'MEMBER',
    }),
    platformAdmin,
    outsider: await user('outsider'),
    suspended: await user('suspended', {
      organizationId: suspendedOrg.id,
      role: 'MEMBER',
    }),
  };
}
