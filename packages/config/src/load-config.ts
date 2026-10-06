import { existsSync } from 'node:fs';
import { z } from 'zod';
import { envSchema, type Env } from './schema.js';
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
    provider: string | undefined;
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
    allowedMimeTypes: string[];
  };
  jobs: {
    pollIntervalMs: number;
    maxAttempts: number;
    retryBackoffMs: number;
  };
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

/** Validates the environment and returns typed configuration, or throws ConfigValidationError. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = parseEnv(envSchema, env);
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
    },
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

/** Like loadConfigOrExit, for the API: also requires authentication settings. */
export function loadApiConfigOrExit(env: NodeJS.ProcessEnv = process.env): {
  config: AppConfig;
  auth: AuthConfig;
} {
  return exitOnConfigError(() => {
    const config = loadConfig(env);
    return { config, auth: requireAuthConfig(config) };
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
