import { Inject, Injectable } from '@nestjs/common';
import {
  type Database,
  memberships,
  organizations,
  users,
} from '@cka/database';
import { and, asc, eq } from 'drizzle-orm';
import { isUniqueViolation } from '../common/database-errors.js';
import { DATABASE } from '../database/database.module.js';
import type { TenantScope } from './tenant-scope.js';

export type MembershipRecord = typeof memberships.$inferSelect;
export type MembershipRole = MembershipRecord['role'];

export class MembershipAlreadyExistsError extends Error {
  constructor() {
    super('The user is already a member of this organization.');
    this.name = 'MembershipAlreadyExistsError';
  }
}

/** A user's membership together with the organization's lifecycle status. */
export interface UserMembership {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  organizationStatus: (typeof organizations.$inferSelect)['status'];
  role: MembershipRole;
}

export interface OrganizationMember {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: MembershipRole;
  createdAt: Date;
}

const memberColumns = {
  membershipId: memberships.id,
  userId: users.id,
  email: users.email,
  displayName: users.displayName,
  role: memberships.role,
  createdAt: memberships.createdAt,
};

/**
 * Memberships are tenant-owned. Organization-side methods take a TenantScope and
 * constrain organization_id in the SQL itself (TDD §8.3).
 */
@Injectable()
export class MembershipsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Creates a membership in the scope's organization; the organization is never a free parameter. */
  async create(
    scope: TenantScope,
    input: { userId: string; role: MembershipRole },
  ): Promise<MembershipRecord> {
    try {
      const [membership] = await this.db
        .insert(memberships)
        .values({ ...input, organizationId: scope.organizationId })
        .returning();
      return membership!;
    } catch (error) {
      if (isUniqueViolation(error, 'memberships_organization_id_user_id_key')) {
        throw new MembershipAlreadyExistsError();
      }
      throw error;
    }
  }

  /** Returns undefined for IDs outside the scope, exactly as for unknown IDs. */
  async findById(
    scope: TenantScope,
    membershipId: string,
  ): Promise<OrganizationMember | undefined> {
    const [member] = await this.db
      .select(memberColumns)
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, scope.organizationId),
          eq(memberships.id, membershipId),
        ),
      );
    return member;
  }

  async listMembers(scope: TenantScope): Promise<OrganizationMember[]> {
    return this.db
      .select(memberColumns)
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, scope.organizationId))
      .orderBy(asc(memberships.createdAt), asc(memberships.id));
  }

  /**
   * User-scoped, not tenant-scoped: the caller's own memberships, used to resolve
   * the Principal. Never call with a user ID taken from client input.
   */
  async listForUser(userId: string): Promise<UserMembership[]> {
    return this.db
      .select({
        membershipId: memberships.id,
        organizationId: memberships.organizationId,
        organizationName: organizations.name,
        organizationStatus: organizations.status,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(eq(memberships.userId, userId))
      .orderBy(asc(memberships.createdAt), asc(memberships.id));
  }
}
