import { Injectable } from '@nestjs/common';
import type { VerifiedIdentity } from '../auth/identity-verifier.js';
import type { AuthenticatedUser } from '../auth/request-context.js';
import { type UserRecord, UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  /**
   * Maps a verified provider identity to the internal User, creating it on first
   * sign-in and keeping email/display name in sync. Grants no organization access.
   */
  async resolveVerifiedIdentity(
    identity: VerifiedIdentity,
  ): Promise<AuthenticatedUser> {
    const profile = {
      email: identity.email,
      displayName: identity.displayName ?? null,
    };
    let user = await this.users.findByAuthSubject(identity.subject);
    if (!user) {
      await this.users.insertIfAbsent({
        authSubject: identity.subject,
        ...profile,
      });
      user = (await this.users.findByAuthSubject(identity.subject))!;
    }
    if (
      user.email !== profile.email ||
      user.displayName !== profile.displayName
    ) {
      user = await this.users.updateProfile(user.id, profile);
    }
    return toAuthenticatedUser(user);
  }
}

function toAuthenticatedUser(user: UserRecord): AuthenticatedUser {
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}
