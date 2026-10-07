import { existsSync } from 'node:fs';
import { z } from 'zod';
import {
  envSchema,
  type Env,
  type SupportedDocumentMimeType,
} from './schema.js';
import type { Secret } from './secret.js';

export interface AppConfig {
  app: {
    nodeEnv: Env['NODE_ENV'];
    logLevel: Env['LOG_LEVEL'];
    port: number;
    publicUrl: string;
    apiPublicUrl: string;
    corsAllowedOrigins: string[];
  };
  database: {
    url: Secret;
  };
  storage: {
    endpoint: string | undefined;
    region: string;
    bucket: string;
    accessKey: Secret;
    secretKey: Secret;
    forcePathStyle: boolean;
  };
  auth: {
    issuerUrl: string | undefined;
    audience: string | undefined;
    jwksUrl: string | undefined;
    emailClaim: string;
    nameClaim: string;
    clientId: string | undefined;
    clientSecret: Secret | undefined;
  };
  ai: {
    provider: Env['AI_PROVIDER'];
    baseUrl: string;
    apiKey: Secret | undefined;
    generationModel: string | undefined;
    embeddingModel: string | undefined;
    embeddingDimensions: number | undefined;
    embeddingBatchSize: number;
    requestTimeoutMs: number;
    maxOutputTokens: number;
  };
  uploads: {
    maxBytes: number;
    allowedMimeTypes: SupportedDocumentMimeType[];
  };
  jobs: {
    pollIntervalMs: number;
    maxAttempts: number;
    retryBackoffMs: number;
    leaseMs: number;
  };
  chunking: {
    sizeTokens: number;
    overlapTokens: number;
  };
  retrieval: {
    candidates: number;
    maxEvidence: number;
    maxPerDocument: number;
  };
  evidence: {
    minTopScore: number;
    minHitScore: number;
  };
  chat: {
    questionMaxChars: number;
  };
  rateLimits: {
    windowMs: number;
    requestsPerIp: number;
    authFailuresPerIp: number;
    asksPerUser: number;
    uploadsPerUser: number;
  };
  /** Trusted reverse-proxy hops for client IPs (0 = none). */
  trustProxy: number;
  /** Enables GET /metrics for scrapers presenting this bearer token. */
  metricsToken: Secret | undefined;
}

/** Thrown when configuration is missing or invalid. The message never contains configuration values. */
export class ConfigValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Invalid configuration. Fix the following environment variables:\n${problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}`,
    );
    this.name = 'ConfigValidationError';
  }
}

// Builds a value-free description of a validation issue.
function describeIssue(
  issue: z.core.$ZodIssue,
  env: NodeJS.ProcessEnv,
): string {
  const name = String(issue.path[0] ?? 'configuration');
  if (env[name] === undefined || env[name]?.trim() === '') {
    return `${name}: is required`;
  }
  switch (issue.code) {
    case 'invalid_format':
      return `${name}: must be a valid ${issue.format === 'url' ? 'URL' : issue.format}`;
    case 'invalid_value':
      return `${name}: must be one of ${issue.values.join(', ')}`;
    case 'too_small':
      return `${name}: must not be empty or below the minimum`;
    case 'too_big':
      return `${name}: must not exceed the maximum`;
    case 'invalid_type':
      return `${name}: must be a ${issue.expected}`;
    default:
      return `${name}: is invalid`;
  }
}

// Parses the environment against a schema, throwing a value-free ConfigValidationError.
function parseEnv<T extends z.ZodType>(
  schema: T,
  env: NodeJS.ProcessEnv,
): z.output<T> {
  // Unset empty strings so optional values behave as absent and required ones report "is required".
  const input = Object.fromEntries(
    Object.entries(env).filter(
      ([, value]) => value !== undefined && value.trim() !== '',
    ),
  );
  const result = schema.safeParse(input);
  if (!result.success) {
    const problems = [
      ...new Set(result.error.issues.map((issue) => describeIssue(issue, env))),
    ];
    throw new ConfigValidationError(problems);
  }
  return result.data;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** HTTPS, or plain HTTP to this machine only (local production-mode runs). */
function isSecureUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** Validates the environment and returns typed configuration, or throws ConfigValidationError. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = parseEnv(envSchema, env);
  if (e.EVIDENCE_MIN_HIT_SCORE > e.EVIDENCE_MIN_TOP_SCORE) {
    throw new ConfigValidationError([
      'EVIDENCE_MIN_HIT_SCORE: must not exceed EVIDENCE_MIN_TOP_SCORE',
    ]);
  }
  if (e.CHUNK_OVERLAP_TOKENS >= e.CHUNK_SIZE_TOKENS) {
    throw new ConfigValidationError([
      'CHUNK_OVERLAP_TOKENS: must be smaller than CHUNK_SIZE_TOKENS',
    ]);
  }
  if (e.NODE_ENV === 'production') {
    // NFR-SEC-01: browser-facing URLs and token verification use TLS.
    const insecure = (
      [
        ['APP_PUBLIC_URL', e.APP_PUBLIC_URL],
        ['API_PUBLIC_URL', e.API_PUBLIC_URL],
        ['AUTH_ISSUER_URL', e.AUTH_ISSUER_URL],
        ['AUTH_JWKS_URL', e.AUTH_JWKS_URL],
        ...(e.CORS_ALLOWED_ORIGINS ?? []).map(
          (origin) => ['CORS_ALLOWED_ORIGINS', origin] as const,
        ),
      ] as const
    )
      .filter(([, value]) => value !== undefined && !isSecureUrl(value))
      .map(([name]) => `${name}: must use https in production`);
    if (insecure.length > 0) {
      throw new ConfigValidationError([...new Set(insecure)]);
    }
  }
  return {
    app: {
      nodeEnv: e.NODE_ENV,
      logLevel: e.LOG_LEVEL,
      port: e.PORT,
      publicUrl: e.APP_PUBLIC_URL,
      apiPublicUrl: e.API_PUBLIC_URL,
      corsAllowedOrigins: e.CORS_ALLOWED_ORIGINS ?? [
        new URL(e.APP_PUBLIC_URL).origin,
      ],
    },
    database: {
      url: e.DATABASE_URL,
    },
    storage: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKey: e.S3_ACCESS_KEY,
      secretKey: e.S3_SECRET_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
    },
    auth: {
      issuerUrl: e.AUTH_ISSUER_URL,
      audience: e.AUTH_AUDIENCE,
      jwksUrl: e.AUTH_JWKS_URL,
      emailClaim: e.AUTH_EMAIL_CLAIM,
      nameClaim: e.AUTH_NAME_CLAIM,
      clientId: e.AUTH_CLIENT_ID,
      clientSecret: e.AUTH_CLIENT_SECRET,
    },
    ai: {
      provider: e.AI_PROVIDER,
      baseUrl: e.AI_BASE_URL,
      apiKey: e.AI_API_KEY,
      generationModel: e.AI_GENERATION_MODEL,
      embeddingModel: e.AI_EMBEDDING_MODEL,
      embeddingDimensions: e.AI_EMBEDDING_DIMENSIONS,
      embeddingBatchSize: e.AI_EMBEDDING_BATCH_SIZE,
      requestTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
      maxOutputTokens: e.AI_MAX_OUTPUT_TOKENS,
    },
    uploads: {
      maxBytes: e.UPLOAD_MAX_BYTES,
      allowedMimeTypes: e.UPLOAD_ALLOWED_MIME_TYPES,
    },
    jobs: {
      pollIntervalMs: e.JOB_POLL_INTERVAL_MS,
      maxAttempts: e.JOB_MAX_ATTEMPTS,
      retryBackoffMs: e.JOB_RETRY_BACKOFF_MS,
      leaseMs: e.JOB_LEASE_MS,
    },
    chunking: {
      sizeTokens: e.CHUNK_SIZE_TOKENS,
      overlapTokens: e.CHUNK_OVERLAP_TOKENS,
    },
    retrieval: {
      candidates: e.RETRIEVAL_CANDIDATES,
      maxEvidence: e.RETRIEVAL_MAX_EVIDENCE,
      maxPerDocument: e.RETRIEVAL_MAX_PER_DOCUMENT,
    },
    evidence: {
      minTopScore: e.EVIDENCE_MIN_TOP_SCORE,
      minHitScore: e.EVIDENCE_MIN_HIT_SCORE,
    },
    chat: {
      questionMaxChars: e.QUESTION_MAX_CHARS,
    },
    rateLimits: {
      windowMs: e.RATE_LIMIT_WINDOW_MS,
      requestsPerIp: e.RATE_LIMIT_REQUESTS_PER_IP,
      authFailuresPerIp: e.RATE_LIMIT_AUTH_FAILURES_PER_IP,
      asksPerUser: e.RATE_LIMIT_ASKS_PER_USER,
      uploadsPerUser: e.RATE_LIMIT_UPLOADS_PER_USER,
    },
    trustProxy: e.TRUST_PROXY,
    metricsToken: e.METRICS_TOKEN,
  };
}

export interface AuthConfig {
  issuerUrl: string;
  audience: string;
  jwksUrl: string;
  emailClaim: string;
  nameClaim: string;
}

/**
 * Returns the authentication settings, which the API requires to verify access
 * tokens. Throws ConfigValidationError naming any missing variables.
 */
export function requireAuthConfig(config: AppConfig): AuthConfig {
  const { issuerUrl, audience, jwksUrl, emailClaim, nameClaim } = config.auth;
  const missing = [
    ['AUTH_ISSUER_URL', issuerUrl],
    ['AUTH_AUDIENCE', audience],
    ['AUTH_JWKS_URL', jwksUrl],
  ]
    .filter(([, value]) => value === undefined)
    .map(([name]) => `${name}: is required`);
  if (missing.length > 0 || !issuerUrl || !audience || !jwksUrl) {
    throw new ConfigValidationError(missing);
  }
  return { issuerUrl, audience, jwksUrl, emailClaim, nameClaim };
}

export interface EmbeddingConfig {
  provider: NonNullable<Env['AI_PROVIDER']>;
  baseUrl: string;
  /** Optional: some OpenAI-compatible servers need no key. */
  apiKey: Secret | undefined;
  model: string;
  dimensions: number;
  batchSize: number;
  requestTimeoutMs: number;
}

/**
 * Returns the embedding provider settings required by the ingestion worker.
 * Throws ConfigValidationError naming any missing variables.
 */
export function requireEmbeddingConfig(config: AppConfig): EmbeddingConfig {
  const { provider, embeddingModel, embeddingDimensions } = config.ai;
  const missing = [
    ['AI_PROVIDER', provider],
    ['AI_EMBEDDING_MODEL', embeddingModel],
    ['AI_EMBEDDING_DIMENSIONS', embeddingDimensions],
  ]
    .filter(([, value]) => value === undefined)
    .map(([name]) => `${String(name)}: is required`);
  if (
    missing.length > 0 ||
    !provider ||
    !embeddingModel ||
    !embeddingDimensions
  ) {
    throw new ConfigValidationError(missing);
  }
  return {
    provider,
    baseUrl: config.ai.baseUrl,
    apiKey: config.ai.apiKey,
    model: embeddingModel,
    dimensions: embeddingDimensions,
    batchSize: config.ai.embeddingBatchSize,
    requestTimeoutMs: config.ai.requestTimeoutMs,
  };
}

export interface GenerationConfig {
  provider: NonNullable<Env['AI_PROVIDER']>;
  baseUrl: string;
  apiKey: Secret | undefined;
  model: string;
  maxOutputTokens: number;
  requestTimeoutMs: number;
}

/**
 * Returns the answer-generation settings required by the API (RAG).
 * Throws ConfigValidationError naming any missing variables.
 */
export function requireGenerationConfig(config: AppConfig): GenerationConfig {
  const { provider, generationModel } = config.ai;
  const missing = [
    ['AI_PROVIDER', provider],
    ['AI_GENERATION_MODEL', generationModel],
  ]
    .filter(([, value]) => value === undefined)
    .map(([name]) => `${String(name)}: is required`);
  if (missing.length > 0 || !provider || !generationModel) {
    throw new ConfigValidationError(missing);
  }
  return {
    provider,
    baseUrl: config.ai.baseUrl,
    apiKey: config.ai.apiKey,
    model: generationModel,
    maxOutputTokens: config.ai.maxOutputTokens,
    requestTimeoutMs: config.ai.requestTimeoutMs,
  };
}

export interface DatabaseConfig {
  url: Secret;
}

/**
 * Validates only the database settings. For tooling such as migrations that must
 * run (e.g. in CI or a deployment step) without the full application configuration.
 */
export function loadDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const e = parseEnv(envSchema.pick({ DATABASE_URL: true }), env);
  return { url: e.DATABASE_URL };
}

/**
 * Loads a local `.env` file into process.env when present (development convenience).
 * Variables already set in the environment take precedence.
 */
export function loadEnvFileIfPresent(path: string | URL): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

/**
 * Process entry-point helper: validates configuration and, on failure, prints the
 * value-free error and exits instead of starting with bad configuration.
 */
export function loadConfigOrExit(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return exitOnConfigError(() => loadConfig(env));
}

/** Like loadConfigOrExit, for the API: also requires authentication, query-embedding and generation settings. */
export function loadApiConfigOrExit(env: NodeJS.ProcessEnv = process.env): {
  config: AppConfig;
  auth: AuthConfig;
  embedding: EmbeddingConfig;
  generation: GenerationConfig;
} {
  return exitOnConfigError(() => {
    const config = loadConfig(env);
    const problems: string[] = [];
    const collect = <T>(require: () => T): T | undefined => {
      try {
        return require();
      } catch (error) {
        if (!(error instanceof ConfigValidationError)) throw error;
        problems.push(...error.problems);
        return undefined;
      }
    };
    const auth = collect(() => requireAuthConfig(config));
    const embedding = collect(() => requireEmbeddingConfig(config));
    const generation = collect(() => requireGenerationConfig(config));
    if (!auth || !embedding || !generation) {
      throw new ConfigValidationError([...new Set(problems)]);
    }
    return { config, auth, embedding, generation };
  });
}

/** Like loadConfigOrExit, for the worker: also requires embedding settings. */
export function loadWorkerConfigOrExit(env: NodeJS.ProcessEnv = process.env): {
  config: AppConfig;
  embedding: EmbeddingConfig;
} {
  return exitOnConfigError(() => {
    const config = loadConfig(env);
    return { config, embedding: requireEmbeddingConfig(config) };
  });
}

/** Like loadConfigOrExit, for processes that only need database settings. */
export function loadDatabaseConfigOrExit(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  return exitOnConfigError(() => loadDatabaseConfig(env));
}

function exitOnConfigError<T>(load: () => T): T {
  try {
    return load();
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
