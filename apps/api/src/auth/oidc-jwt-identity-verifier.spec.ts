import { requireAuthConfig } from '@cka/config';
import { SignJWT, UnsecuredJWT } from 'jose';
import { createTestConfig } from '../testing/test-config.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from '../testing/test-identity-provider.js';
import {
  IdentityProviderUnavailableError,
  InvalidCredentialError,
} from './identity-verifier.js';
import { OidcJwtIdentityVerifier } from './oidc-jwt-identity-verifier.js';

describe('OidcJwtIdentityVerifier', () => {
  let idp: TestIdentityProvider;
  let verifier: OidcJwtIdentityVerifier;

  beforeAll(async () => {
    idp = await startTestIdentityProvider();
    verifier = new OidcJwtIdentityVerifier(createTestConfig(idp.env()).auth);
  });

  afterAll(async () => {
    await idp.close();
  });

  it('verifies a valid token and returns provider-neutral identity only', async () => {
    const token = await idp.token('user-1', {
      email: 'user1@example.test',
      name: 'User One',
      roles: ['PLATFORM_ADMIN'],
      org_id: 'some-org',
    });

    await expect(verifier.verify(token)).resolves.toEqual({
      subject: 'user-1',
      email: 'user1@example.test',
      displayName: 'User One',
    });
  });

  it.each([
    ['wrong issuer', () => idp.token('u', { iss: 'https://evil.test/' })],
    ['wrong audience', () => idp.token('u', { aud: 'other-api' })],
    ['expired', () => idp.token('u', {}, { expiresIn: -60 })],
    ['signed by an unknown key', () => idp.token('u', {}, { key: 'foreign' })],
    [
      'unsigned (alg none)',
      async () =>
        new UnsecuredJWT({ email: 'u@example.test' })
          .setSubject('u')
          .setIssuer(idp.issuer)
          .setAudience(idp.audience)
          .setExpirationTime('5m')
          .encode(),
    ],
    [
      'symmetric (HS256)',
      () =>
        new SignJWT({ email: 'u@example.test' })
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject('u')
          .setIssuer(idp.issuer)
          .setAudience(idp.audience)
          .setExpirationTime('5m')
          .sign(
            new TextEncoder().encode('a-shared-secret-of-sufficient-length'),
          ),
    ],
    ['missing email claim', () => idp.token('u', { email: '' })],
    ['garbage', async () => 'not.a.jwt'],
  ])('rejects a token that is %s', async (_, makeToken) => {
    await expect(verifier.verify(await makeToken())).rejects.toBeInstanceOf(
      InvalidCredentialError,
    );
  });

  it('reads email/name from configured claims', async () => {
    const custom = new OidcJwtIdentityVerifier({
      ...requireAuthConfig(createTestConfig(idp.env()).config),
      emailClaim: 'https://cka.test/email',
      nameClaim: 'nickname',
    });
    const token = await idp.token('u', {
      email: undefined,
      'https://cka.test/email': 'custom@example.test',
      nickname: 'Nick',
    });

    await expect(custom.verify(token)).resolves.toEqual({
      subject: 'u',
      email: 'custom@example.test',
      displayName: 'Nick',
    });
  });

  it('reports an unreachable JWKS as provider unavailable', async () => {
    const unreachable = new OidcJwtIdentityVerifier(createTestConfig().auth);
    const token = await idp.token('u');

    await expect(unreachable.verify(token)).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );
  });
});
