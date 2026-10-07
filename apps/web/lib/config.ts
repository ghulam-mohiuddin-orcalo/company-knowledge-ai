/**
 * Public browser configuration (inlined at build time). Never put secrets here:
 * the web app is a public OIDC client and talks only to the NestJS API.
 */
export interface WebConfig {
  apiUrl: string;
  oidcAuthority: string;
  oidcClientId: string;
  oidcScope: string;
  /** Some providers (e.g. Auth0) need the API audience on the authorize request. */
  oidcAudience: string | undefined;
}

export function readWebConfig():
  { ok: true; config: WebConfig } | { ok: false; missing: string[] } {
  // Referenced literally so Next.js can inline them.
  const values = {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_OIDC_AUTHORITY: process.env.NEXT_PUBLIC_OIDC_AUTHORITY,
    NEXT_PUBLIC_OIDC_CLIENT_ID: process.env.NEXT_PUBLIC_OIDC_CLIENT_ID,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: {
      apiUrl: values.NEXT_PUBLIC_API_URL!.replace(/\/+$/, ''),
      oidcAuthority: values.NEXT_PUBLIC_OIDC_AUTHORITY!,
      oidcClientId: values.NEXT_PUBLIC_OIDC_CLIENT_ID!,
      oidcScope: process.env.NEXT_PUBLIC_OIDC_SCOPE || 'openid profile email',
      oidcAudience: process.env.NEXT_PUBLIC_OIDC_AUDIENCE || undefined,
    },
  };
}
