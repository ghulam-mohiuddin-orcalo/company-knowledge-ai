import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ApiRequest } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import type { MembershipRole } from './memberships.repository.js';

/**
 * The trusted identity and tenant for a request. Built server-side from the
 * verified user and a membership lookup; never from client-supplied tenant IDs.
 */
export interface Principal {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: MembershipRole;
}

export interface TenantRequest extends ApiRequest {
  principal?: Principal;
}

/** Header a client may use to choose among its own organizations; verified against memberships. */
export const ORGANIZATION_HEADER = 'x-organization-id';

/** Injects the request Principal (set by AuthorizationGuard for tenant policies). */
export const CurrentPrincipal = createParamDecorator(
  (_: unknown, context: ExecutionContext): Principal => {
    const principal = context
      .switchToHttp()
      .getRequest<TenantRequest>().principal;
    if (!principal) throw ApiError.forbidden();
    return principal;
  },
);
