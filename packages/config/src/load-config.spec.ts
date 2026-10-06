import { inspect } from 'node:util';
import {
  ConfigValidationError,
  loadConfig,
  loadDatabaseConfig,
  requireAuthConfig,
} from './load-config.js';

const DB_PASSWORD = 'db-password-should-not-leak';
const S3_SECRET = 's3-secret-should-not-leak';

const validEnv = {
  APP_PUBLIC_URL: 'http://localhost:3000',
  API_PUBLIC_URL: 'http://localhost:3001',
  DATABASE_URL: `postgresql://cka:${DB_PASSWORD}@127.0.0.1:5432/company_knowledge`,
  S3_ENDPOINT: 'http://127.0.0.1:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'cka-documents-local',
  S3_ACCESS_KEY: 'access-key',
  S3_SECRET_KEY: S3_SECRET,
  S3_FORCE_PATH_STYLE: 'true',
};

function captureError(
  env: NodeJS.ProcessEnv,
  load: (env: NodeJS.ProcessEnv) => unknown = loadConfig,
): ConfigValidationError {
  try {
    load(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) return error;
    throw error;
  }
  throw new Error('Expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = loadConfig(validEnv);

    expect(config.app).toEqual({
      nodeEnv: 'development',
      logLevel: 'log',
      port: 3001,
      publicUrl: 'http://localhost:3000',
      apiPublicUrl: 'http://localhost:3001',
      corsAllowedOrigins: ['http://localhost:3000'],
    });
    expect(config.storage.forcePathStyle).toBe(true);
    expect(config.database.url.reveal()).toBe(validEnv.DATABASE_URL);
    expect(config.uploads.allowedMimeTypes).toHaveLength(3);
    expect(config.jobs).toEqual({
      pollIntervalMs: 2000,
      maxAttempts: 3,
      retryBackoffMs: 5000,
    });
    expect(config.ai.apiKey).toBeUndefined();
  });

  it('parses numbers and comma-separated lists', () => {
    const config = loadConfig({
      ...validEnv,
      PORT: '4000',
      UPLOAD_MAX_BYTES: '1048576',
      CORS_ALLOWED_ORIGINS: 'https://a.example, https://b.example',
    });

    expect(config.app.port).toBe(4000);
    expect(config.uploads.maxBytes).toBe(1_048_576);
    expect(config.app.corsAllowedOrigins).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('reports every missing required variable by name', () => {
    const error = captureError({});

    expect(error.problems).toEqual(
      expect.arrayContaining([
        'APP_PUBLIC_URL: is required',
        'API_PUBLIC_URL: is required',
        'DATABASE_URL: is required',
        'S3_REGION: is required',
        'S3_BUCKET: is required',
        'S3_ACCESS_KEY: is required',
        'S3_SECRET_KEY: is required',
      ]),
    );
  });

  it('treats empty values as missing', () => {
    expect(captureError({ ...validEnv, DATABASE_URL: '  ' }).problems).toEqual([
      'DATABASE_URL: is required',
    ]);
  });

  it('reports invalid values without echoing them', () => {
    const error = captureError({
      ...validEnv,
      APP_PUBLIC_URL: 'not-a-url-secret-ish',
      PORT: 'abc',
      NODE_ENV: 'staging',
      S3_FORCE_PATH_STYLE: 'yes',
    });

    expect(error.problems).toEqual(
      expect.arrayContaining([
        'APP_PUBLIC_URL: must be a valid URL',
        'PORT: must be a number',
        'NODE_ENV: must be one of development, test, production',
        'S3_FORCE_PATH_STYLE: must be one of true, false',
      ]),
    );
    expect(error.message).not.toContain('not-a-url-secret-ish');
    expect(error.message).not.toContain('staging');
  });

  it('never exposes secrets when configuration is printed', () => {
    const config = loadConfig({
      ...validEnv,
      AI_API_KEY: 'ai-key-should-not-leak',
    });
    const printed = [
      JSON.stringify(config),
      inspect(config, { depth: null }),
      `${config.storage.secretKey}`,
    ];

    for (const output of printed) {
      expect(output).not.toContain(DB_PASSWORD);
      expect(output).not.toContain(S3_SECRET);
      expect(output).not.toContain('ai-key-should-not-leak');
      expect(output).toContain('[REDACTED]');
    }
  });

  it('never exposes secrets in validation errors', () => {
    const error = captureError({ ...validEnv, APP_PUBLIC_URL: undefined });

    expect(error.message).toContain('APP_PUBLIC_URL: is required');
    expect(error.message).not.toContain(DB_PASSWORD);
    expect(error.message).not.toContain(S3_SECRET);
  });
});

describe('loadDatabaseConfig', () => {
  it('rejects a malformed DATABASE_URL without echoing it', () => {
    const error = captureError(
      { DATABASE_URL: `not a url ${DB_PASSWORD}` },
      loadDatabaseConfig,
    );

    expect(error.problems).toEqual(['DATABASE_URL: must be a valid URL']);
    expect(error.message).not.toContain(DB_PASSWORD);
  });

  it('requires only DATABASE_URL', () => {
    const config = loadDatabaseConfig({ DATABASE_URL: validEnv.DATABASE_URL });

    expect(config.url.reveal()).toBe(validEnv.DATABASE_URL);
    expect(JSON.stringify(config)).not.toContain(DB_PASSWORD);
  });

  it('reports a missing DATABASE_URL without other variables', () => {
    expect(() => loadDatabaseConfig({})).toThrow(
      new ConfigValidationError(['DATABASE_URL: is required']),
    );
  });
});

describe('requireAuthConfig', () => {
  it('names every missing authentication variable', () => {
    expect(() => requireAuthConfig(loadConfig(validEnv))).toThrow(
      new ConfigValidationError([
        'AUTH_ISSUER_URL: is required',
        'AUTH_AUDIENCE: is required',
        'AUTH_JWKS_URL: is required',
      ]),
    );
  });

  it('returns authentication settings with claim defaults', () => {
    const config = loadConfig({
      ...validEnv,
      AUTH_ISSUER_URL: 'https://idp.example/',
      AUTH_AUDIENCE: 'cka-api',
      AUTH_JWKS_URL: 'https://idp.example/.well-known/jwks.json',
    });

    expect(requireAuthConfig(config)).toEqual({
      issuerUrl: 'https://idp.example/',
      audience: 'cka-api',
      jwksUrl: 'https://idp.example/.well-known/jwks.json',
      emailClaim: 'email',
      nameClaim: 'name',
    });
  });
});
