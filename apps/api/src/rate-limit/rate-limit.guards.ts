import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiRequest } from '../auth/request-context.js';
import {
  RATE_LIMITED_OPERATION,
  SKIP_RATE_LIMIT,
} from './rate-limit.decorators.js';
import {
  type RateLimitedOperation,
  RateLimitService,
} from './rate-limit.service.js';

/** First global guard: per-IP request limit, before any authentication work. */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!skip) {
      const request = context.switchToHttp().getRequest<ApiRequest>();
      this.limits.consumeRequest(request.ip ?? 'unknown');
    }
    return true;
  }
}

/** Last global guard: per-user limits for costly operations (ask, upload). */
@Injectable()
export class OperationRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const operation = this.reflector.get<RateLimitedOperation | undefined>(
      RATE_LIMITED_OPERATION,
      context.getHandler(),
    );
    const user = context.switchToHttp().getRequest<ApiRequest>().authUser;
    if (operation && user) this.limits.consumeOperation(operation, user.userId);
    return true;
  }
}
