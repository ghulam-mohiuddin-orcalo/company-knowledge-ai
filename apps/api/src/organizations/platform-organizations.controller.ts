import { Controller, Get, Inject } from '@nestjs/common';
import { type Database, recordAuditEvent } from '@cka/database';
import { getLogContext } from '@cka/observability';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { Authorize } from '../authorization/authorize.decorator.js';
import { OrganizationsRepository } from './organizations.repository.js';
import type { PlatformOrganizationResponse } from '@cka/contracts';
export type { PlatformOrganizationResponse };

/**
 * Platform operations (FR-OPS-01): identify organizations and their status.
 * Exposes organization metadata only, never tenant content.
 */
@Controller('v1/platform/organizations')
export class PlatformOrganizationsController {
  constructor(
    private readonly organizations: OrganizationsRepository,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Get()
  @Authorize('PLATFORM_ADMIN')
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformOrganizationResponse[]> {
    const organizations = await this.organizations.listAll();
    // Privileged cross-tenant read: audited (TDD §8.2).
    await recordAuditEvent(this.db, {
      action: 'PLATFORM_ORGANIZATIONS_LISTED',
      organizationId: null,
      actorUserId: user.userId,
      targetType: 'organization',
      targetId: null,
      metadata: { count: organizations.length },
      requestId: getLogContext().requestId,
    });
    return organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      status: organization.status,
      createdAt: organization.createdAt.toISOString(),
    }));
  }
}
