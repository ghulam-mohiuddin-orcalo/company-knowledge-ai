import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AuthorizationGuard } from './authorization.guard.js';

@Module({
  imports: [TenancyModule],
  providers: [AuthorizationGuard],
  exports: [AuthorizationGuard],
})
export class AuthorizationModule {}
