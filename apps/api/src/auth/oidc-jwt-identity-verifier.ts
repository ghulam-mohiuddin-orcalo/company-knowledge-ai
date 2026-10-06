import type { AuthConfig } from '@cka/config';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import {
  IdentityProviderUnavailableError,
  type IdentityVerifier,
  InvalidCredentialError,
  type VerifiedIdentity,
} from './identity-verifier.js';

// Asymmetric algorithms only: symmetric (HS*) and "none" tokens are always rejected.
const ALLOWED_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'ES256',
  'ES384',
  'EdDSA',
];

/** Verifies OIDC JWT access tokens against the provider's JWKS, issuer and audience. */
export class OidcJwtIdentityVerifier implements IdentityVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: AuthConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUrl));
  }

  async verify(accessToken: string): Promise<VerifiedIdentity> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(accessToken, this.jwks, {
        issuer: this.config.issuerUrl,
        audience: this.config.audience,
        algorithms: ALLOWED_ALGORITHMS,
        requiredClaims: ['sub', 'exp'],
      }));
    } catch (error) {
      if (
        error instanceof errors.JWKSTimeout ||
        !(error instanceof errors.JOSEError)
      ) {
        throw new IdentityProviderUnavailableError(
          error instanceof Error ? error.name : 'unknown error',
        );
      }
      throw new InvalidCredentialError(error.code);
    }

    const subject = payload.sub;
    const email = payload[this.config.emailClaim];
    const name = payload[this.config.nameClaim];
    if (typeof subject !== 'string' || subject.trim() === '') {
      throw new InvalidCredentialError('missing subject');
    }
    if (typeof email !== 'string' || email.trim() === '') {
      throw new InvalidCredentialError(
        `missing ${this.config.emailClaim} claim`,
      );
    }
    return {
      subject,
      email: email.trim(),
      displayName:
        typeof name === 'string' && name.trim() !== ''
          ? name.trim()
          : undefined,
    };
  }
}
