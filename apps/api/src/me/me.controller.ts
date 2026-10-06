import { Controller, Get, Req } from '@nestjs/common';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/request-context.js';
import { Authorize } from '../authorization/authorize.decorator.js';
import { ApiError } from '../common/api-error.js';
import { OrganizationsRepository } from '../organizations/organizations.repository.js';
import type { MembershipRole } from '../tenancy/memberships.repository.js';
import type { Principal, TenantRequest } from '../tenancy/principal.js';
import { readOrganizationHeader } from '../tenancy/organization-header.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';

export interface MeResponse {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    isPlatformAdmin: boolean;
  };
  activeOrganization: {
    id: string;
    name: string;
    membershipId: string;
    role: MembershipRole;
  } | null;
}

@Authorize('AUTHENTICATED')
@Controller('v1/me')
export class MeController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly organizations: OrganizationsRepository,
  ) {}

  /**
   * The internal user and, when resolvable, the active organization and role.
   * A requested organization (header) must be valid; without one, an unresolved
   * tenant (no, several or a suspended membership) is reported as null.
   */
  @Get()
  async me(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: TenantRequest,
  ): Promise<MeResponse> {
    const requested = readOrganizationHeader(request);
    let principal: Principal | null = null;
    try {
      principal = await this.tenantContext.resolve(user, requested);
    } catch (error) {
      if (requested !== undefined || !(error instanceof ApiError)) throw error;
    }

    const organization = principal
      ? await this.organizations.findById(principal.organizationId)
      : undefined;
    return {
      user: {
        id: user.userId,
        email: user.email,
        displayName: user.displayName,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      activeOrganization:
        principal && organization
          ? {
              id: organization.id,
              name: organization.name,
              membershipId: principal.membershipId,
              role: principal.role,
            }
          : null,
    };
  }
}
