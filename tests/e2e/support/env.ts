/** Shared E2E settings. Ports avoid the default dev ports so a dev stack can stay up. */
export const WEB_URL = 'http://localhost:3100';
export const API_URL = 'http://localhost:3101';
export const AI_PORT = 39102;
export const OIDC_ISSUER = 'http://localhost:8080/default';
export const API_AUDIENCE = 'company-knowledge-api';

const BASE_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://cka:cka_local_dev@127.0.0.1:5432/company_knowledge';

/** A dedicated database, recreated for every E2E run. */
export const E2E_DATABASE_URL = (() => {
  const url = new URL(BASE_DATABASE_URL);
  url.pathname = '/cka_e2e';
  return url.toString();
})();

/** Backend environment for the API and worker under test (local stack defaults). */
export const BACKEND_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  APP_PUBLIC_URL: WEB_URL,
  API_PUBLIC_URL: API_URL,
  PORT: '3101',
  DATABASE_URL: E2E_DATABASE_URL,
  S3_ENDPOINT: 'http://127.0.0.1:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'cka-documents-local',
  S3_ACCESS_KEY: 'cka_local_access',
  S3_SECRET_KEY: 'cka_local_secret',
  S3_FORCE_PATH_STYLE: 'true',
  AUTH_ISSUER_URL: OIDC_ISSUER,
  AUTH_AUDIENCE: API_AUDIENCE,
  AUTH_JWKS_URL: `${OIDC_ISSUER}/jwks`,
  AI_PROVIDER: 'openai-compatible',
  AI_BASE_URL: `http://127.0.0.1:${AI_PORT}/v1`,
  AI_API_KEY: 'sk-e2e-not-a-real-key',
  AI_EMBEDDING_MODEL: 'text-embedding-3-small',
  AI_EMBEDDING_DIMENSIONS: '1536',
  AI_GENERATION_MODEL: 'e2e-extractive',
  // Thresholds calibrated for the offline embedding stand-in (see docs/rag-evaluation).
  EVIDENCE_MIN_TOP_SCORE: '0.30',
  EVIDENCE_MIN_HIT_SCORE: '0.20',
  JOB_POLL_INTERVAL_MS: '300',
  LOG_LEVEL: 'log',
};

export const WEB_ENV: Record<string, string> = {
  NEXT_PUBLIC_API_URL: API_URL,
  NEXT_PUBLIC_OIDC_AUTHORITY: OIDC_ISSUER,
  NEXT_PUBLIC_OIDC_CLIENT_ID: 'company-knowledge-web',
};

/** Seeded users (mock IdP usernames = token subjects). */
export const USERS = {
  admin: 'e2e-admin',
  member: 'e2e-member',
  multi: 'e2e-multi',
  otherAdmin: 'e2e-other-admin',
  platform: 'e2e-platform',
  outsider: 'e2e-outsider',
} as const;
export type E2EUser = keyof typeof USERS;
