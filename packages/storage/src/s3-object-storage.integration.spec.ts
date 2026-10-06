import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { loadConfig, loadEnvFileIfPresent } from '@cka/config';
import { documentObjectKey } from './object-keys.js';
import { ObjectNotFoundError, ObjectStorageError } from './object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));

// Needs local storage (`pnpm infra:up`); defaults match infra/docker.
const env = {
  APP_PUBLIC_URL: 'http://localhost:3000',
  API_PUBLIC_URL: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://unused@127.0.0.1/unused',
  S3_ENDPOINT: 'http://127.0.0.1:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'cka-documents-local',
  S3_ACCESS_KEY: 'cka_local_access',
  S3_SECRET_KEY: 'cka_local_secret',
  S3_FORCE_PATH_STYLE: 'true',
  ...process.env,
};
const config = loadConfig(env).storage;

describe('S3ObjectStorage (E2-T02)', () => {
  const storage = new S3ObjectStorage(config);
  const key = documentObjectKey(randomUUID(), randomUUID());

  afterAll(async () => {
    await storage.deleteObject(key);
    storage.destroy();
  });

  it('stores and reads back an object', async () => {
    await storage.putObject(key, Buffer.from('hello'), {
      contentType: 'text/plain',
    });

    expect((await storage.getObject(key)).toString()).toBe('hello');
  });

  it('keeps objects private: anonymous reads are denied', async () => {
    const endpoint = config.endpoint!.replace(/\/$/, '');
    const response = await fetch(`${endpoint}/${config.bucket}/${key}`);

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('hello');
  });

  it('reports missing objects distinctly', async () => {
    await expect(
      storage.getObject(documentObjectKey(randomUUID(), randomUUID())),
    ).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('deletes idempotently', async () => {
    const other = documentObjectKey(randomUUID(), randomUUID());
    await storage.putObject(other, Buffer.from('x'), {
      contentType: 'text/plain',
    });

    await storage.deleteObject(other);
    await storage.deleteObject(other);
    await expect(storage.getObject(other)).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it('never exposes credentials in errors or when inspected', async () => {
    const badSecret = 'definitely-not-the-secret-value';
    const bad = new S3ObjectStorage(
      loadConfig({ ...env, S3_SECRET_KEY: badSecret }).storage,
    );
    const error = await bad
      .putObject(key, Buffer.from('x'), { contentType: 'text/plain' })
      .catch((e: unknown) => e);
    bad.destroy();

    expect(error).toBeInstanceOf(ObjectStorageError);
    const printed = `${String(error)} ${inspect(error)} ${JSON.stringify(error)}`;
    expect(printed).not.toContain(badSecret);
    expect(printed).not.toContain('cka_local_access');
    expect(inspect(config)).not.toContain(config.secretKey.reveal());
  });
});
