import { Injectable } from '@nestjs/common';
import {
  type MembershipRecord,
  type MembershipRole,
  MembershipsRepository,
  type OrganizationMember,
} from './memberships.repository.js';
import type { TenantScope } from './tenant-scope.js';

@Injectable()
export class MembershipsService {
  constructor(private readonly memberships: MembershipsRepository) {}

  /** Adds a user to the scope's organization; throws MembershipAlreadyExistsError on duplicates. */
  async addMember(
    scope: TenantScope,
    userId: string,
    role: MembershipRole,
  ): Promise<MembershipRecord> {
    return this.memberships.create(scope, { userId, role });
  }

  async listMembers(scope: TenantScope): Promise<OrganizationMember[]> {
    return this.memberships.listMembers(scope);
  }

  async getMember(
    scope: TenantScope,
    membershipId: string,
  ): Promise<OrganizationMember | undefined> {
    return this.memberships.findById(scope, membershipId);
  }
}
