import { Module } from '@nestjs/common';
import { MembershipsRepository } from './memberships.repository.js';
import { MembershipsService } from './memberships.service.js';
import { OrganizationMembersController } from './organization-members.controller.js';
import { TenantContextService } from './tenant-context.service.js';

@Module({
  controllers: [OrganizationMembersController],
  providers: [MembershipsRepository, MembershipsService, TenantContextService],
  exports: [MembershipsRepository, MembershipsService, TenantContextService],
})
export class TenancyModule {}
