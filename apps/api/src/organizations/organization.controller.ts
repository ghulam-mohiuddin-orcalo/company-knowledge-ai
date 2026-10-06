import { Controller, Get } from '@nestjs/common';
import { Authorize } from '../authorization/authorize.decorator.js';
import { ApiError } from '../common/api-error.js';
import type { MembershipRole } from '../tenancy/memberships.repository.js';
import { CurrentPrincipal, type Principal } from '../tenancy/principal.js';
import { OrganizationsRepository } from './organizations.repository.js';

export interface CurrentOrganizationResponse {
  id: string;
  name: string;
  role: MembershipRole;
}

/** The caller's active organization (tenant derived from the Principal only). */
@Controller('v1/organization')
export class OrganizationController {
  constructor(private readonly organizations: OrganizationsRepository) {}

  @Get()
  @Authorize('MEMBER')
  async current(
    @CurrentPrincipal() principal: Principal,
  ): Promise<CurrentOrganizationResponse> {
    const organization = await this.organizations.findById(
      principal.organizationId,
    );
    if (!organization) throw ApiError.notFound();
    return {
      id: organization.id,
      name: organization.name,
      role: principal.role,
    };
  }
}
