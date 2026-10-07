import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { MembershipsRepository } from './memberships.repository.js';
import type { Principal } from './principal.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantContextService {
  constructor(private readonly memberships: MembershipsRepository) {}

  /**
   * Resolves the active organization for a verified user from their own memberships.
   * `requestedOrganizationId` (from the X-Organization-Id header) only selects among
   * those memberships; an organization the user does not belong to is refused
   * identically whether or not it exists.
   */
  async resolve(
    user: AuthenticatedUser,
    requestedOrganizationId: string | undefined,
  ): Promise<Principal> {
    if (
      requestedOrganizationId !== undefined &&
      !UUID.test(requestedOrganizationId)
    ) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'The organization identifier is invalid.',
      );
    }

    const memberships = await this.memberships.listForUser(user.userId);
    let membership;
    if (requestedOrganizationId !== undefined) {
      membership = memberships.find(
        (m) => m.organizationId === requestedOrganizationId.toLowerCase(),
      );
      if (!membership) {
        throw ApiError.forbidden('You are not a member of this organization.');
      }
    } else if (memberships.length === 1) {
      membership = memberships[0]!;
    } else if (memberships.length === 0) {
      throw ApiError.forbidden('You are not a member of any organization.');
    } else {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'ORGANIZATION_SELECTION_REQUIRED',
        'Select an organization with the X-Organization-Id header.',
      );
    }

    if (membership.organizationStatus !== 'ACTIVE') {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'ORGANIZATION_SUSPENDED',
        'This organization is suspended.',
      );
    }

    return {
      userId: user.userId,
      organizationId: membership.organizationId,
      membershipId: membership.membershipId,
      role: membership.role,
    };
  }
}
