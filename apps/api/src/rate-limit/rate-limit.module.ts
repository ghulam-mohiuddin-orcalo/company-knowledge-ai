import { Global, Module } from '@nestjs/common';
import {
  IpRateLimitGuard,
  OperationRateLimitGuard,
} from './rate-limit.guards.js';
import { RateLimitService } from './rate-limit.service.js';

@Global()
@Module({
  providers: [RateLimitService, IpRateLimitGuard, OperationRateLimitGuard],
  exports: [RateLimitService, IpRateLimitGuard, OperationRateLimitGuard],
})
export class RateLimitModule {}
