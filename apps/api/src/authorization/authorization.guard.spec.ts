import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../auth/public.decorator.js';
import type { AuthenticatedUser } from '../auth/request-context.js';
import type { TenantContextService } from '../tenancy/tenant-context.service.js';
import { AuthorizationGuard } from './authorization.guard.js';
import { ACCESS_POLICY, type AccessPolicy } from './authorize.decorator.js';

const user: AuthenticatedUser = {
  userId: 'u',
  email: 'u@example.test',
  displayName: null,
  isPlatformAdmin: false,
};

function run(
  metadata: { policy?: AccessPolicy; isPublic?: boolean },
  authUser: AuthenticatedUser | undefined,
  role: 'MEMBER' | 'ORG_ADMIN' = 'MEMBER',
) {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
    key === IS_PUBLIC
      ? metadata.isPublic
      : key === ACCESS_POLICY
        ? metadata.policy
        : undefined,
  );
  const tenantContext = {
    resolve: vi.fn().mockResolvedValue({
      userId: 'u',
      organizationId: 'org',
      membershipId: 'm',
      role,
    }),
  } as unknown as TenantContextService;
  const request: Record<string, unknown> = { headers: {}, authUser };
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const guard = new AuthorizationGuard(reflector, tenantContext);
  return { result: guard.canActivate(context), request, tenantContext };
}

describe('AuthorizationGuard (E1-T04)', () => {
  it('allows public routes without a user', async () => {
    await expect(run({ isPublic: true }, undefined).result).resolves.toBe(true);
  });

  it('fails closed for routes that declare no policy', async () => {
    await expect(run({}, user).result).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('requires an authenticated user for any policy', async () => {
    await expect(
      run({ policy: 'AUTHENTICATED' }, undefined).result,
    ).rejects.toMatchObject({
      status: 401,
    });
  });

  it('denies MEMBERs on ORG_ADMIN routes', async () => {
    await expect(
      run({ policy: 'ORG_ADMIN' }, user, 'MEMBER').result,
    ).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('allows ORG_ADMINs on MEMBER and ORG_ADMIN routes and attaches the principal', async () => {
    for (const policy of ['MEMBER', 'ORG_ADMIN'] as const) {
      const { result, request } = run({ policy }, user, 'ORG_ADMIN');
      await expect(result).resolves.toBe(true);
      expect(request.principal).toMatchObject({
        organizationId: 'org',
        role: 'ORG_ADMIN',
      });
    }
  });

  it('allows PLATFORM_ADMIN routes only for platform admins, without tenant resolution', async () => {
    const denied = run({ policy: 'PLATFORM_ADMIN' }, user);
    await expect(denied.result).rejects.toMatchObject({ status: 403 });

    const allowed = run(
      { policy: 'PLATFORM_ADMIN' },
      { ...user, isPlatformAdmin: true },
    );
    await expect(allowed.result).resolves.toBe(true);
    expect(allowed.tenantContext.resolve).not.toHaveBeenCalled();
  });
});
