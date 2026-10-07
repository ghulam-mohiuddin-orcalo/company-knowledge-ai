import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTPayload,
  SignJWT,
} from 'jose';

export interface TestIdentityProvider {
  issuer: string;
  audience: string;
  jwksUrl: string;
  /** Signs an access token for `subject` with the provider's key, merging `claims`. */
  token(
    subject: string,
    claims?: JWTPayload & { email?: string; name?: string },
    options?: { expiresIn?: string | number; key?: 'provider' | 'foreign' },
  ): Promise<string>;
  /** Env overrides pointing API configuration at this provider. */
  env(): NodeJS.ProcessEnv;
  close(): Promise<void>;
}

/**
 * A local OIDC-style token issuer: serves a JWKS over HTTP (exercising the real
 * remote-JWKS path) and signs RS256 access tokens. A second "foreign" key is not
 * published, to test signature rejection.
 */
export async function startTestIdentityProvider(): Promise<TestIdentityProvider> {
  const providerKey = await generateKeyPair('RS256');
  const foreignKey = await generateKeyPair('RS256');
  const publicJwk: JWK = {
    ...(await exportJWK(providerKey.publicKey)),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
  };

  const server: Server = createServer((request, response) => {
    if (request.url === '/.well-known/jwks.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const issuer = `http://127.0.0.1:${port}/`;
  const audience = 'cka-api-test';
  const jwksUrl = `http://127.0.0.1:${port}/.well-known/jwks.json`;

  return {
    issuer,
    audience,
    jwksUrl,
    async token(subject, claims = {}, options = {}) {
      const key = options.key === 'foreign' ? foreignKey : providerKey;
      return new SignJWT({ email: `${subject}@example.test`, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setSubject(subject)
        .setIssuer(claims.iss ?? issuer)
        .setAudience(claims.aud ?? audience)
        .setIssuedAt()
        .setExpirationTime(options.expiresIn ?? '5m')
        .sign(key.privateKey);
    },
    env: () => ({
      AUTH_ISSUER_URL: issuer,
      AUTH_AUDIENCE: audience,
      AUTH_JWKS_URL: jwksUrl,
    }),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
