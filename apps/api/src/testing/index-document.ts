import type { EmbeddingProvider } from '@cka/ai';
import {
  type Database,
  documentChunks,
  documents,
  ingestionJobs,
} from '@cka/database';
import {
  chunkSegments,
  cl100kTokenCounter,
  createExtractors,
  extractDocument,
} from '@cka/ingestion';
import { and, eq } from 'drizzle-orm';

/**
 * Test stand-in for the worker: indexes an uploaded document with the
 * production extraction/chunking steps and marks it READY.
 */
export async function indexUploadedDocument(
  db: Database,
  documentId: string,
  content: Buffer,
  embeddings: EmbeddingProvider,
): Promise<void> {
  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId));
  const [job] = await db
    .select()
    .from(ingestionJobs)
    .where(eq(ingestionJobs.documentId, documentId));
  const segments = await extractDocument(
    createExtractors(),
    document!.mimeType,
    content,
  );
  const chunks = chunkSegments(
    segments,
    { sizeTokens: 800, overlapTokens: 120 },
    cl100kTokenCounter,
  );
  const vectors = await embeddings.embedTexts(chunks.map((c) => c.content));
  await db.transaction(async (tx) => {
    await tx.insert(documentChunks).values(
      chunks.map((chunk, i) => ({
        ...chunk,
        organizationId: document!.organizationId,
        documentId,
        ingestionJobId: job!.id,
        embedding: vectors[i]!,
        embeddingModel: embeddings.model,
      })),
    );
    await tx
      .update(documents)
      .set({ status: 'READY' })
      .where(and(eq(documents.id, documentId)));
    await tx
      .update(ingestionJobs)
      .set({ status: 'SUCCEEDED', attempt: 1 })
      .where(eq(ingestionJobs.id, job!.id));
  });
}
