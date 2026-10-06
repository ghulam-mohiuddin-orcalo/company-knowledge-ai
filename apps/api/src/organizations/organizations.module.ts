import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller.js';
import { OrganizationsRepository } from './organizations.repository.js';
import { OrganizationsService } from './organizations.service.js';
import { PlatformOrganizationsController } from './platform-organizations.controller.js';

@Module({
  controllers: [OrganizationController, PlatformOrganizationsController],
  providers: [OrganizationsRepository, OrganizationsService],
  exports: [OrganizationsRepository, OrganizationsService],
})
export class OrganizationsModule {}
