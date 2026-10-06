import { Controller, Get } from '@nestjs/common';
import { Authorize } from '../authorization/authorize.decorator.js';
import {
  OrganizationsRepository,
  type OrganizationStatus,
} from './organizations.repository.js';

export interface PlatformOrganizationResponse {
  id: string;
  name: string;
  status: OrganizationStatus;
  createdAt: string;
}

/**
 * Platform operations (FR-OPS-01): identify organizations and their status.
 * Exposes organization metadata only, never tenant content.
 */
@Controller('v1/platform/organizations')
export class PlatformOrganizationsController {
  constructor(private readonly organizations: OrganizationsRepository) {}

  @Get()
  @Authorize('PLATFORM_ADMIN')
  async list(): Promise<PlatformOrganizationResponse[]> {
    const organizations = await this.organizations.listAll();
    return organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      status: organization.status,
      createdAt: organization.createdAt.toISOString(),
    }));
  }
}
