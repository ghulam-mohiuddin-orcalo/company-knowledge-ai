import type { Principal } from './principal.js';

declare const tenantScopeBrand: unique symbol;

/**
 * Proof of which organization a tenant-owned query is allowed to touch.
 *
 * Convention (E1-T05): every repository method that reads or writes a tenant-owned
 * table takes `scope: TenantScope` as its first parameter and filters/sets
 * `organization_id = scope.organizationId` inside the query. Generic `findById(id)`
 * on tenant resources is forbidden (enforced by ESLint for `*.repository.ts`).
 * A plain string cannot be passed where a TenantScope is expected.
 */
export type TenantScope = {
  readonly organizationId: string;
  readonly [tenantScopeBrand]: true;
};

export const TenantScope = {
  /** The scope for a request: the Principal's server-resolved organization. */
  fromPrincipal(principal: Principal): TenantScope {
    return Object.freeze({
      organizationId: principal.organizationId,
    }) as TenantScope;
  },

  /**
   * For trusted server-side contexts without a request Principal (platform
   * operations, seeding, background jobs). `organizationId` must come from
   * server-held data, never from client input.
   */
  forSystem(organizationId: string): TenantScope {
    return Object.freeze({ organizationId }) as TenantScope;
  },
};
