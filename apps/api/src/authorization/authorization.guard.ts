import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../auth/public.decorator.js';
import { ApiError } from '../common/api-error.js';
import { readOrganizationHeader } from '../tenancy/organization-header.js';
import type { TenantRequest } from '../tenancy/principal.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { ACCESS_POLICY, type AccessPolicy } from './authorize.decorator.js';

/**
 * Global guard (runs after AuthenticationGuard). Enforces the route's access
 * policy server-side and fails closed for routes that declare none.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  private readonly logger = new Logger(AuthorizationGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<TenantRequest>();
    const user = request.authUser;
    if (!user) throw ApiError.unauthenticated();

    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(
      ACCESS_POLICY,
      targets,
    );
    switch (policy) {
      case 'AUTHENTICATED':
        return true;
      case 'PLATFORM_ADMIN':
        if (!user.isPlatformAdmin) throw ApiError.forbidden();
        return true;
      case 'MEMBER':
      case 'ORG_ADMIN': {
        const principal = await this.tenantContext.resolve(
          user,
          readOrganizationHeader(request),
        );
        if (policy === 'ORG_ADMIN' && principal.role !== 'ORG_ADMIN') {
          throw ApiError.forbidden();
        }
        request.principal = principal;
        return true;
      }
      default:
        this.logger.error(
          `Route ${context.getClass().name}.${context.getHandler().name} declares no access policy; denied`,
        );
        throw ApiError.forbidden();
    }
  }
}
