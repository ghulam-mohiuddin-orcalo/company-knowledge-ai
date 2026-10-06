import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { MeController } from './me.controller.js';

@Module({
  imports: [TenancyModule, OrganizationsModule],
  controllers: [MeController],
})
export class MeModule {}
