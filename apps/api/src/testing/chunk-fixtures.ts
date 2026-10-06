import { randomUUID } from 'node:crypto';
import {
  type Database,
  documentChunks,
  documents,
  EMBEDDING_DIMENSIONS,
  ingestionJobs,
} from '@cka/database';
import { documentObjectKey } from '@cka/storage';

type DocumentStatus = (typeof documents.$inferInsert)['status'];

/** A unit vector along `axis` (optionally mixed with `mix` along `mixAxis`). */
export function axisVector(
  axis: number,
  mix = 0,
  mixAxis = axis + 1,
): number[] {
  const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[axis] = 1;
  if (mix) vector[mixAxis] = mix;
  const norm = Math.hypot(...vector);
  return vector.map((v) => v / norm);
}

export interface SeededChunk {
  content: string;
  embedding: number[];
  pageNumber?: number;
  sectionPath?: string;
  charStart?: number;
}

/**
 * Inserts an indexed document directly (as the worker would after ingestion).
 * Test-only: bypasses upload and the pipeline to control vectors exactly.
 */
export async function seedIndexedDocument(
  db: Database,
  tenant: { organizationId: string; uploadedBy: string },
  options: { filename: string; status?: DocumentStatus; chunks: SeededChunk[] },
): Promise<{ documentId: string; chunkIds: string[] }> {
  const documentId = randomUUID();
  await db.insert(documents).values({
    id: documentId,
    organizationId: tenant.organizationId,
    uploadedBy: tenant.uploadedBy,
    filename: options.filename,
    storageKey: documentObjectKey(tenant.organizationId, documentId),
    mimeType: 'text/plain',
    sizeBytes: 1,
    status: options.status ?? 'READY',
  });
  const [job] = await db
    .insert(ingestionJobs)
    .values({
      organizationId: tenant.organizationId,
      documentId,
      idempotencyKey: `document:${documentId}:ingest`,
      status: 'SUCCEEDED',
    })
    .returning();
  const rows = await db
    .insert(documentChunks)
    .values(
      options.chunks.map((chunk, chunkIndex) => {
        const charStart = chunk.charStart ?? 0;
        return {
          organizationId: tenant.organizationId,
          documentId,
          ingestionJobId: job!.id,
          chunkIndex,
          content: chunk.content,
          tokenCount: Math.max(1, chunk.content.split(/\s+/).length),
          pageNumber: chunk.pageNumber ?? null,
          sectionPath: chunk.sectionPath ?? null,
          charStart,
          charEnd: charStart + chunk.content.length,
          embedding: chunk.embedding,
          embeddingModel: 'test',
        };
      }),
    )
    .returning({ id: documentChunks.id });
  return { documentId, chunkIds: rows.map((r) => r.id) };
}
