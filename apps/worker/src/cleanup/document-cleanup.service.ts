import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, documentChunks, documents } from '@cka/database';
import { type ObjectStorage } from '@cka/storage';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE, OBJECT_STORAGE } from '../tokens.js';

/**
 * Asynchronous deletion cleanup (E2-T05). A DELETING document is already
 * non-retrievable; this removes its derived data and stored object, then marks
 * it DELETED. Safe to run concurrently and to repeat after a crash.
 */
@Injectable()
export class DocumentCleanupService {
  private readonly logger = new Logger(DocumentCleanupService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Cleans up one DELETING document. Returns false when there was nothing to do. */
  async cleanupNext(): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // The row lock keeps concurrent workers (and ingestion commits) off this document.
      const [document] = await tx
        .select({
          id: documents.id,
          organizationId: documents.organizationId,
          storageKey: documents.storageKey,
        })
        .from(documents)
        .where(eq(documents.status, 'DELETING'))
        .orderBy(asc(documents.updatedAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!document) return false;

      // Derived retrieval data first, then the original.
      await tx
        .delete(documentChunks)
        .where(
          and(
            eq(documentChunks.organizationId, document.organizationId),
            eq(documentChunks.documentId, document.id),
          ),
        );
      // Idempotent: a missing object (earlier partial cleanup) is fine. A storage
      // failure aborts the transaction, leaving the document DELETING for a retry.
      await this.storage.deleteObject(document.storageKey);
      await tx
        .update(documents)
        .set({ status: 'DELETED' })
        .where(
          and(
            eq(documents.organizationId, document.organizationId),
            eq(documents.id, document.id),
          ),
        );
      this.logger.log(`Document ${document.id} cleaned up`);
      return true;
    });
  }
}
