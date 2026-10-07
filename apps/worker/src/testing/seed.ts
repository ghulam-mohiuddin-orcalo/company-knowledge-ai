import {
  type Database,
  documents,
  ingestionJobs,
  organizations,
  users,
} from '@cka/database';
import { documentObjectKey } from '@cka/storage';
import { randomUUID } from 'node:crypto';

type DocumentStatus = (typeof documents.$inferInsert)['status'];

/** Inserts an organization and an uploader directly (worker tests have no API). */
export async function seedTenant(
  db: Database,
  name = 'Org',
): Promise<{ organizationId: string; userId: string }> {
  const [organization] = await db
    .insert(organizations)
    .values({ name })
    .returning();
  const [user] = await db
    .insert(users)
    .values({ authSubject: `seed-${randomUUID()}`, email: 'seed@example.test' })
    .returning();
  return { organizationId: organization!.id, userId: user!.id };
}

/** Inserts a document (and optionally its queued ingestion job), like the upload API does. */
export async function seedDocument(
  db: Database,
  tenant: { organizationId: string; userId: string },
  options: {
    status?: DocumentStatus;
    mimeType?: string;
    sizeBytes?: number;
    withJob?: boolean;
  } = {},
): Promise<{ documentId: string; storageKey: string; jobId?: string }> {
  const documentId = randomUUID();
  const storageKey = documentObjectKey(tenant.organizationId, documentId);
  await db.insert(documents).values({
    id: documentId,
    organizationId: tenant.organizationId,
    uploadedBy: tenant.userId,
    filename: 'seed.txt',
    storageKey,
    mimeType: options.mimeType ?? 'text/plain',
    sizeBytes: options.sizeBytes ?? 1,
    status: options.status ?? 'QUEUED',
  });
  if (!options.withJob) return { documentId, storageKey };
  const [job] = await db
    .insert(ingestionJobs)
    .values({
      organizationId: tenant.organizationId,
      documentId,
      idempotencyKey: `document:${documentId}:ingest`,
    })
    .returning();
  return { documentId, storageKey, jobId: job!.id };
}
