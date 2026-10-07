import { z } from 'zod';
import { Secret } from './secret.js';

const requiredString = z.string().trim().min(1);
const optionalString = requiredString.optional();
const secret = requiredString.transform((value) => new Secret(value));
const url = z.url();
const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().min(0);
const similarity = z.coerce.number().min(-1).max(1);
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

/** Document types the ingestion pipeline can extract (BA FR-DOC-01). */
export const SUPPORTED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
] as const;
export type SupportedDocumentMimeType =
  (typeof SUPPORTED_DOCUMENT_MIME_TYPES)[number];

const supportedMimeList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(SUPPORTED_DOCUMENT_MIME_TYPES)).min(1));

/**
 * Every environment variable the backend (api + worker) reads.
 * Variable names are defined here only; application code consumes the typed result.
 *
 * AI provider settings are optional here: the worker requires the embedding
 * settings (see requireEmbeddingConfig); generation settings arrive with E5-T02. Authentication settings are
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
  // Provider adapters available (TDD §18). 'openai-compatible' covers OpenAI,
  // Azure OpenAI and compatible servers via AI_BASE_URL.
  AI_PROVIDER: z.enum(['openai-compatible']).optional(),
  AI_BASE_URL: url.default('https://api.openai.com/v1'),
  AI_API_KEY: secret.optional(),
  AI_GENERATION_MODEL: optionalString,
  AI_EMBEDDING_MODEL: optionalString,
  AI_EMBEDDING_DIMENSIONS: positiveInt.optional(),
  AI_EMBEDDING_BATCH_SIZE: positiveInt.default(64),
  AI_REQUEST_TIMEOUT_MS: positiveInt.default(30_000),
  AI_MAX_OUTPUT_TOKENS: positiveInt.default(1024),

  // Uploads (BA FR-DOC-01: PDF, DOCX, TXT)
  UPLOAD_MAX_BYTES: positiveInt.default(25 * 1024 * 1024),
  // Subset of SUPPORTED_DOCUMENT_MIME_TYPES; types without an extractor are rejected.
  UPLOAD_ALLOWED_MIME_TYPES: supportedMimeList.default([
    ...SUPPORTED_DOCUMENT_MIME_TYPES,
  ]),

  // Background jobs
  JOB_POLL_INTERVAL_MS: positiveInt.default(2000),
  JOB_MAX_ATTEMPTS: positiveInt.default(3),
  JOB_RETRY_BACKOFF_MS: positiveInt.default(5000),
  // A PROCESSING job whose lease expires (worker crash) becomes claimable again.
  JOB_LEASE_MS: positiveInt.default(10 * 60 * 1000),

  // Chunking (TDD §12.1): tuned against the evaluation corpus, not fixed requirements.
  CHUNK_SIZE_TOKENS: positiveInt.default(800),
  CHUNK_OVERLAP_TOKENS: nonNegativeInt.default(120),

  // Retrieval (TDD §14): candidates fetched, evidence passed on, per-document cap.
  RETRIEVAL_CANDIDATES: positiveInt.default(10),
  RETRIEVAL_MAX_EVIDENCE: positiveInt.default(5),
  RETRIEVAL_MAX_PER_DOCUMENT: positiveInt.default(3),

  // Evidence sufficiency (TDD §15). Cosine-similarity thresholds depend on the
  // embedding model; defaults target text-embedding-3-small and must be
  // calibrated with the evaluation corpus (pnpm eval) for the configured model.
  EVIDENCE_MIN_TOP_SCORE: similarity.default(0.35),
  EVIDENCE_MIN_HIT_SCORE: similarity.default(0.25),

  // Chat
  QUESTION_MAX_CHARS: positiveInt.default(2000),

  // Abuse controls (E8-T03): fixed windows, per API instance.
  RATE_LIMIT_WINDOW_MS: positiveInt.default(60_000),
  RATE_LIMIT_REQUESTS_PER_IP: positiveInt.default(600),
  RATE_LIMIT_AUTH_FAILURES_PER_IP: positiveInt.default(20),
  RATE_LIMIT_ASKS_PER_USER: positiveInt.default(20),
  RATE_LIMIT_UPLOADS_PER_USER: positiveInt.default(30),
  // Number of reverse proxies in front of the API whose X-Forwarded-For entries
  // are trusted for client IPs (rate limits). Only the entries those proxies
  // appended are used, so clients cannot spoof their IP. 'false' = 0 (direct
  // exposure), 'true' = 1 (a single TLS proxy/load balancer).
  TRUST_PROXY: z
    .union([
      z
        .enum(['true', 'false'])
        .transform((value) => (value === 'true' ? 1 : 0)),
      z.coerce.number().int().min(0).max(10),
    ])
    .default(0),
  // Bearer token for GET /metrics (E8-T05). Unset: the endpoint is disabled.
  METRICS_TOKEN: z
    .string()
    .min(16, 'must be at least 16 characters')
    .transform((value) => new Secret(value))
    .optional(),
});

export type Env = z.output<typeof envSchema>;
