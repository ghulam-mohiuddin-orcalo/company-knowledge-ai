import { randomUUID } from 'node:crypto';
import { loadDatabaseConfig, loadEnvFileIfPresent } from '@cka/config';
import pg from 'pg';
import { runMigrations } from './migrate.js';
import { EMBEDDING_DIMENSIONS } from './schema.js';

loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
const baseUrl = loadDatabaseConfig().url.reveal();

// Each run migrates a brand-new, empty database to prove migrations work from zero.
const databaseName = `cka_migration_test_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = (() => {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
})();

async function withClient<T>(
  connectionString: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe('database migrations', () => {
  beforeAll(async () => {
    await withClient(baseUrl, (client) =>
      client.query(`CREATE DATABASE "${databaseName}"`),
    );
  });

  afterAll(async () => {
    await withClient(baseUrl, (client) =>
      client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`),
    );
  });

  it('migrates an empty database forward from zero', async () => {
    await runMigrations(databaseUrl);

    await withClient(databaseUrl, async (client) => {
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'answer_citations',
        'conversations',
        'document_chunks',
        'documents',
        'ingestion_jobs',
        'memberships',
        'messages',
        'organizations',
        'users',
      ]);

      const extension = await client.query(
        `SELECT 1 FROM pg_extension WHERE extname = 'vector'`,
      );
      expect(extension.rowCount).toBe(1);
    });
  });

  it('is safe to re-run when already up to date', async () => {
    await expect(runMigrations(databaseUrl)).resolves.toBeUndefined();
  });

  it('supports the document and ingestion job lifecycles', async () => {
    await withClient(databaseUrl, async (client) => {
      const enumValues = async (type: string) =>
        (
          await client.query<{ value: string }>(
            `SELECT unnest(enum_range(NULL::${type}))::text AS value`,
          )
        ).rows.map((row) => row.value);

      expect(await enumValues('document_status')).toEqual([
        'QUEUED',
        'PROCESSING',
        'READY',
        'FAILED',
        'DELETING',
        'DELETED',
      ]);
      expect(await enumValues('ingestion_job_status')).toEqual([
        'QUEUED',
        'PROCESSING',
        'SUCCEEDED',
        'FAILED',
        'CANCELLED',
      ]);
    });
  });

  it('enforces document and ingestion job constraints', async () => {
    await withClient(databaseUrl, async (client) => {
      const org = async (name: string) =>
        (
          await client.query<{ id: string }>(
            `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
            [name],
          )
        ).rows[0]!.id;
      const orgA = await org('Doc Org A');
      const orgB = await org('Doc Org B');
      const user = (
        await client.query<{ id: string }>(
          `INSERT INTO users (auth_subject, email) VALUES ('doc-sub', 'd@example.test') RETURNING id`,
        )
      ).rows[0]!.id;
      const insertDocument = (key: string, size = 10) =>
        client.query<{ id: string; status: string }>(
          `INSERT INTO documents (organization_id, uploaded_by, filename, storage_key, mime_type, size_bytes)
           VALUES ($1, $2, 'a.txt', $3, 'text/plain', $4) RETURNING id, status`,
          [orgA, user, key, size],
        );

      const document = (await insertDocument('key-1')).rows[0]!;
      expect(document.status).toBe('QUEUED');
      await expect(insertDocument('key-1')).rejects.toMatchObject({
        code: '23505',
      });
      await expect(insertDocument('key-2', 0)).rejects.toMatchObject({
        code: '23514',
      });

      const insertJob = (organizationId: string, key: string) =>
        client.query(
          `INSERT INTO ingestion_jobs (organization_id, document_id, idempotency_key) VALUES ($1, $2, $3)`,
          [organizationId, document.id, key],
        );
      await insertJob(orgA, 'job-1');
      // Duplicate enqueue and cross-tenant job rows are rejected by the database.
      await expect(insertJob(orgA, 'job-1')).rejects.toMatchObject({
        code: '23505',
      });
      await expect(insertJob(orgB, 'job-2')).rejects.toMatchObject({
        code: '23503',
      });
    });
  });

  it('enforces the chunk vector dimension, uniqueness and tenant consistency', async () => {
    await withClient(databaseUrl, async (client) => {
      const one = async <T>(sql: string, params: unknown[] = []) =>
        (await client.query<T & object>(sql, params)).rows[0]!;
      const orgA = (
        await one<{ id: string }>(
          `INSERT INTO organizations (name) VALUES ('Chunk A') RETURNING id`,
        )
      ).id;
      const orgB = (
        await one<{ id: string }>(
          `INSERT INTO organizations (name) VALUES ('Chunk B') RETURNING id`,
        )
      ).id;
      const user = (
        await one<{ id: string }>(
          `INSERT INTO users (auth_subject, email) VALUES ('chunk-sub', 'c@example.test') RETURNING id`,
        )
      ).id;
      const doc = (
        await one<{ id: string }>(
          `INSERT INTO documents (organization_id, uploaded_by, filename, storage_key, mime_type, size_bytes)
         VALUES ($1, $2, 'c.txt', 'chunk-key', 'text/plain', 5) RETURNING id`,
          [orgA, user],
        )
      ).id;
      const job = (
        await one<{ id: string }>(
          `INSERT INTO ingestion_jobs (organization_id, document_id, idempotency_key)
         VALUES ($1, $2, 'chunk-job') RETURNING id`,
          [orgA, doc],
        )
      ).id;
      const vector = (dims: number) => `[${Array(dims).fill(0.01).join(',')}]`;
      const insertChunk = (
        organizationId: string,
        index: number,
        dims = EMBEDDING_DIMENSIONS,
      ) =>
        client.query(
          `INSERT INTO document_chunks (organization_id, document_id, ingestion_job_id, chunk_index,
             content, token_count, char_start, char_end, embedding, embedding_model)
           VALUES ($1, $2, $3, $4, 'text', 1, 0, 4, $5, 'test-model')`,
          [organizationId, doc, job, index, vector(dims)],
        );

      await insertChunk(orgA, 0);
      // Wrong embedding dimension, duplicate chunk index, cross-tenant chunk.
      await expect(insertChunk(orgA, 1, 3)).rejects.toMatchObject({
        code: '22000',
      });
      await expect(insertChunk(orgA, 0)).rejects.toMatchObject({
        code: '23505',
      });
      await expect(insertChunk(orgB, 2)).rejects.toMatchObject({
        code: '23503',
      });

      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'document_chunks' ORDER BY indexname`,
      );
      expect(indexes.rows.map((r) => r.indexname)).toEqual([
        'document_chunks_document_id_chunk_index_key',
        'document_chunks_organization_id_document_id_idx',
        'document_chunks_pkey',
      ]);
    });
  });

  it('enforces membership constraints', async () => {
    await withClient(databaseUrl, async (client) => {
      const org = await client.query<{ id: string }>(
        `INSERT INTO organizations (name) VALUES ('Org A') RETURNING id`,
      );
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (auth_subject, email) VALUES ('sub-1', 'a@example.com') RETURNING id`,
      );
      const insertMembership = (role: string) =>
        client.query(
          `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`,
          [org.rows[0]!.id, user.rows[0]!.id, role],
        );

      await insertMembership('MEMBER');
      await expect(insertMembership('ORG_ADMIN')).rejects.toMatchObject({
        code: '23505', // unique_violation: one membership per user per organization
      });
      await expect(
        client.query(
          `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'MEMBER')`,
          [randomUUID(), user.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ code: '23503' }); // foreign_key_violation
      await expect(
        client.query(
          `INSERT INTO users (auth_subject, email) VALUES ('sub-1', 'b@example.com')`,
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});
