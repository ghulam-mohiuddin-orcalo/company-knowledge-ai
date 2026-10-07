import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Authorize } from '../authorization/authorize.decorator.js';
import { ApiError } from '../common/api-error.js';
import type { OrganizationMember } from './memberships.repository.js';
import { MembershipsService } from './memberships.service.js';
import { CurrentPrincipal, type Principal } from './principal.js';
import { TenantScope } from './tenant-scope.js';
import type { OrganizationMemberResponse } from '@cka/contracts';
export type { OrganizationMemberResponse };

/** Organization member management (ORG_ADMIN, TDD §8.2); read-only in E1. */
@Controller('v1/organization/members')
export class OrganizationMembersController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  @Authorize('ORG_ADMIN')
  async list(
    @CurrentPrincipal() principal: Principal,
  ): Promise<OrganizationMemberResponse[]> {
    const members = await this.memberships.listMembers(
      TenantScope.fromPrincipal(principal),
    );
    return members.map(toResponse);
  }

  /** Another tenant's membership ID is indistinguishable from an unknown one (404). */
  @Get(':membershipId')
  @Authorize('ORG_ADMIN')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
  ): Promise<OrganizationMemberResponse> {
    const member = await this.memberships.getMember(
      TenantScope.fromPrincipal(principal),
      membershipId,
    );
    if (!member) throw ApiError.notFound();
    return toResponse(member);
  }
}

function toResponse(member: OrganizationMember): OrganizationMemberResponse {
  return {
    membershipId: member.membershipId,
    userId: member.userId,
    email: member.email,
    displayName: member.displayName,
    role: member.role,
  };
}
