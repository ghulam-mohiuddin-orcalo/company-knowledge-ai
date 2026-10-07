import { randomUUID } from 'node:crypto';
import net from 'node:net';
import pg from 'pg';
import { runMigrations } from './migrate.js';

export interface TestDatabase {
  url: string;
  drop(): Promise<void>;
}

/**
 * Test helper: creates and migrates a brand-new database next to `baseUrl`, so
 * each test file starts from an empty schema. Never use outside tests.
 */
export async function createTestDatabase(
  baseUrl: string,
): Promise<TestDatabase> {
  const name = `cka_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;

  const admin = async (sql: string): Promise<void> => {
    const client = new pg.Client({ connectionString: baseUrl });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };

  await admin(`CREATE DATABASE "${name}"`);
  await runMigrations(url.toString());
  return {
    url: url.toString(),
    drop: () => admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
  };
}

export interface DatabaseOutageProxy {
  /** The database URL routed through the proxy. */
  url: string;
  /** Drops every open connection and refuses new ones (a database outage). */
  outage(): void;
  /** Accepts connections again (the database is back). */
  restore(): void;
  close(): Promise<void>;
}

/**
 * Test helper: a TCP proxy in front of PostgreSQL that can simulate an outage
 * (E8-T06), so failure boundaries are tested against real drivers and pools.
 */
export async function startDatabaseOutageProxy(
  databaseUrl: string,
): Promise<DatabaseOutageProxy> {
  const target = new URL(databaseUrl);
  const sockets = new Set<net.Socket>();
  let down = false;
  const server = net.createServer((client) => {
    if (down) {
      client.destroy();
      return;
    }
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    sockets.add(client).add(upstream);
    const drop = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('error', drop).on('close', drop);
    upstream.on('error', drop).on('close', drop);
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(databaseUrl);
  url.hostname = '127.0.0.1';
  url.port = String((server.address() as net.AddressInfo).port);
  return {
    url: url.toString(),
    outage() {
      down = true;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    },
    restore() {
      down = false;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Queries an ingestion invariant must never return rows for (E8-T06). */
const INGESTION_INVARIANTS: Array<[string, string]> = [
  [
    'searchable chunks for a document that is not READY (or being deleted)',
    `SELECT DISTINCT d.id, d.status FROM documents d
       JOIN document_chunks c ON c.document_id = d.id
      WHERE d.status NOT IN ('READY', 'DELETING')`,
  ],
  [
    'READY document without an index',
    `SELECT d.id FROM documents d
      WHERE d.status = 'READY'
        AND NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id)`,
  ],
  [
    'READY document without exactly one succeeded job',
    `SELECT d.id, count(j.id) AS succeeded FROM documents d
       LEFT JOIN ingestion_jobs j ON j.document_id = d.id AND j.status = 'SUCCEEDED'
      WHERE d.status = 'READY'
      GROUP BY d.id HAVING count(j.id) <> 1`,
  ],
  [
    'chunks from more than one ingestion run (duplicate processing)',
    `SELECT document_id, count(DISTINCT ingestion_job_id) AS runs FROM document_chunks
      GROUP BY document_id HAVING count(DISTINCT ingestion_job_id) > 1`,
  ],
  [
    'chunks not produced by the document’s succeeded job',
    `SELECT DISTINCT c.document_id FROM document_chunks c
       JOIN ingestion_jobs j ON j.id = c.ingestion_job_id
      WHERE j.status <> 'SUCCEEDED' OR j.document_id <> c.document_id`,
  ],
  [
    'chunks in a different tenant than their document',
    `SELECT DISTINCT c.document_id FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE d.organization_id <> c.organization_id`,
  ],
  [
    'more than one active job for a document',
    `SELECT document_id FROM ingestion_jobs
      WHERE status IN ('QUEUED', 'PROCESSING')
      GROUP BY document_id HAVING count(*) > 1`,
  ],
  [
    'queued or processing document without an active job (stuck)',
    `SELECT d.id, d.status FROM documents d
      WHERE d.status IN ('QUEUED', 'PROCESSING')
        AND NOT EXISTS (SELECT 1 FROM ingestion_jobs j
                         WHERE j.document_id = d.id AND j.status IN ('QUEUED', 'PROCESSING'))`,
  ],
  [
    'processing job without a claim and lease',
    `SELECT id FROM ingestion_jobs
      WHERE status = 'PROCESSING' AND (claim_token IS NULL OR lease_expires_at IS NULL)`,
  ],
  [
    'deleted document still holding chunks',
    `SELECT DISTINCT d.id FROM documents d
       JOIN document_chunks c ON c.document_id = d.id
      WHERE d.status = 'DELETED'`,
  ],
];

/**
 * Test helper: checks the ingestion consistency invariants (E8-T06) — no
 * inconsistent READY state, no orphan searchable data, no duplicate job
 * processing, nothing stuck. Returns human-readable violations (empty if none).
 */
export async function ingestionInvariantViolations(
  databaseUrl: string,
): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const violations: string[] = [];
    for (const [name, query] of INGESTION_INVARIANTS) {
      const { rows } = await client.query(query);
      if (rows.length > 0) violations.push(`${name}: ${JSON.stringify(rows)}`);
    }
    return violations;
  } finally {
    await client.end();
  }
}
