import { z } from 'zod';
import { Secret } from './secret.js';

const requiredString = z.string().trim().min(1);
const optionalString = requiredString.optional();
const secret = requiredString.transform((value) => new Secret(value));
const url = z.url();
const positiveInt = z.coerce.number().int().positive();
const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');
const commaList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(requiredString).min(1));

/**
 * Every environment variable the backend (api + worker) reads.
 * Variable names are defined here only; application code consumes the typed result.
 *
 * AI provider settings stay optional until the tickets that integrate those
 * providers (E3-T04, E5-T02) make them required. Authentication settings are
 * required by the API only (see requireAuthConfig); the worker does not authenticate.
 */
export const envSchema = z.object({
  // App
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'log', 'debug', 'verbose'])
    .default('log'),
  PORT: positiveInt.default(3001),
  APP_PUBLIC_URL: url,
  API_PUBLIC_URL: url,
  CORS_ALLOWED_ORIGINS: commaList.optional(),

  // Database
  DATABASE_URL: url.transform((value) => new Secret(value)),

  // Object storage (S3-compatible)
  S3_ENDPOINT: url.optional(),
  S3_REGION: requiredString,
  S3_BUCKET: requiredString,
  S3_ACCESS_KEY: secret,
  S3_SECRET_KEY: secret,
  S3_FORCE_PATH_STYLE: booleanFlag.default(false),

  // Authentication
  // Any OIDC provider issuing JWT access tokens signed with asymmetric keys.
  AUTH_ISSUER_URL: url.optional(),
  AUTH_AUDIENCE: optionalString,
  AUTH_JWKS_URL: url.optional(),
  AUTH_EMAIL_CLAIM: requiredString.default('email'),
  AUTH_NAME_CLAIM: requiredString.default('name'),
  AUTH_CLIENT_ID: optionalString,
  AUTH_CLIENT_SECRET: secret.optional(),

  // AI providers
  AI_PROVIDER: optionalString,
  AI_API_KEY: secret.optional(),
  AI_GENERATION_MODEL: optionalString,
  AI_EMBEDDING_MODEL: optionalString,
  AI_EMBEDDING_DIMENSIONS: positiveInt.optional(),
  AI_EMBEDDING_BATCH_SIZE: positiveInt.default(64),
  AI_REQUEST_TIMEOUT_MS: positiveInt.default(30_000),
  AI_MAX_OUTPUT_TOKENS: positiveInt.default(1024),

  // Uploads (BA FR-DOC-01: PDF, DOCX, TXT)
  UPLOAD_MAX_BYTES: positiveInt.default(25 * 1024 * 1024),
  UPLOAD_ALLOWED_MIME_TYPES: commaList.default([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ]),

  // Background jobs
  JOB_POLL_INTERVAL_MS: positiveInt.default(2000),
  JOB_MAX_ATTEMPTS: positiveInt.default(3),
  JOB_RETRY_BACKOFF_MS: positiveInt.default(5000),
});

export type Env = z.output<typeof envSchema>;
