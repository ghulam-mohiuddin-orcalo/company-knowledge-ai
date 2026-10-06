/** Identity proven by the authentication provider, normalized to provider-neutral fields. */
export interface VerifiedIdentity {
  /** Stable provider subject (`sub`). */
  subject: string;
  email: string;
  displayName: string | undefined;
}

/**
 * Backend identity adapter. Implementations verify a credential and return only
 * identity facts; provider claims (roles, groups, org IDs) are never used for authorization.
 */
export interface IdentityVerifier {
  /** Throws InvalidCredentialError or IdentityProviderUnavailableError. */
  verify(accessToken: string): Promise<VerifiedIdentity>;
}

export const IDENTITY_VERIFIER = Symbol('IDENTITY_VERIFIER');

export class InvalidCredentialError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidCredentialError';
  }
}

export class IdentityProviderUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'IdentityProviderUnavailableError';
  }
}
