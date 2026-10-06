import { SetMetadata } from '@nestjs/common';

/**
 * Route access policies (TDD §8.2). Every non-public route must declare exactly one.
 * - AUTHENTICATED: any verified user; no tenant context.
 * - MEMBER: active membership in the selected organization (MEMBER or ORG_ADMIN).
 * - ORG_ADMIN: ORG_ADMIN membership in the selected organization.
 * - PLATFORM_ADMIN: platform operator; cross-tenant operations, no tenant context.
 *   Platform admins have no implicit access to organization (tenant) routes.
 */
export type AccessPolicy =
  'AUTHENTICATED' | 'MEMBER' | 'ORG_ADMIN' | 'PLATFORM_ADMIN';

export const ACCESS_POLICY = 'authorization:policy';

export const Authorize = (
  policy: AccessPolicy,
): MethodDecorator & ClassDecorator => SetMetadata(ACCESS_POLICY, policy);
