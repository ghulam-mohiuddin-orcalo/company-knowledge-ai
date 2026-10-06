import { Inject, Injectable } from '@nestjs/common';
import { type Database, documents, ingestionJobs, users } from '@cka/database';
import { and, desc, eq, inArray, lt, notInArray, or } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';
import type { TenantScope } from '../tenancy/tenant-scope.js';

export type DocumentStatus = (typeof documents.$inferSelect)['status'];

/** Statuses of documents that no longer exist for users (deletion lifecycle). */
export const REMOVED_STATUSES: DocumentStatus[] = ['DELETING', 'DELETED'];

/** Client-safe document metadata (no storage key, hash or internal errors). */
export interface DocumentView {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  errorCode: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface NewDocument {
  id: string;
  uploadedBy: string;
  filename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

const viewColumns = {
  id: documents.id,
  filename: documents.filename,
  mimeType: documents.mimeType,
  sizeBytes: documents.sizeBytes,
  status: documents.status,
  errorCode: documents.errorCode,
  uploaderId: users.id,
  uploaderEmail: users.email,
  uploaderName: users.displayName,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

type ViewRow = {
  [K in keyof typeof viewColumns]: (typeof viewColumns)[K]['_']['data'] | null;
};

function toView(row: ViewRow): DocumentView {
  return {
    id: row.id!,
    filename: row.filename!,
    mimeType: row.mimeType!,
    sizeBytes: row.sizeBytes!,
    status: row.status!,
    errorCode: row.errorCode,
    uploadedBy: {
      id: row.uploaderId!,
      name: row.uploaderName ?? row.uploaderEmail!,
    },
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
  };
}

/** Documents are tenant-owned: every method takes a TenantScope (TDD §8.3). */
@Injectable()
export class DocumentsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Persists the document and its queued ingestion job atomically. */
  async createWithIngestionJob(
    scope: TenantScope,
    input: NewDocument,
  ): Promise<DocumentView> {
    await this.db.transaction(async (tx) => {
      await tx.insert(documents).values({
        ...input,
        organizationId: scope.organizationId,
        status: 'QUEUED',
      });
      await tx.insert(ingestionJobs).values({
        organizationId: scope.organizationId,
        documentId: input.id,
        idempotencyKey: `document:${input.id}:ingest`,
      });
    });
    return (await this.findActiveById(scope, input.id))!;
  }

  /** Undefined for unknown, foreign-tenant, deleting or deleted documents. */
  async findActiveById(
    scope: TenantScope,
    documentId: string,
  ): Promise<DocumentView | undefined> {
    const [row] = await this.db
      .select(viewColumns)
      .from(documents)
      .innerJoin(users, eq(users.id, documents.uploadedBy))
      .where(
        and(
          eq(documents.organizationId, scope.organizationId),
          eq(documents.id, documentId),
          notInArray(documents.status, REMOVED_STATUSES),
        ),
      );
    return row ? toView(row) : undefined;
  }

  /** Newest first; keyset pagination on (created_at, id). */
  async listActive(
    scope: TenantScope,
    page: { limit: number; after?: { createdAt: Date; id: string } },
  ): Promise<DocumentView[]> {
    const after = page.after;
    const rows = await this.db
      .select(viewColumns)
      .from(documents)
      .innerJoin(users, eq(users.id, documents.uploadedBy))
      .where(
        and(
          eq(documents.organizationId, scope.organizationId),
          notInArray(documents.status, REMOVED_STATUSES),
          after
            ? or(
                lt(documents.createdAt, after.createdAt),
                and(
                  eq(documents.createdAt, after.createdAt),
                  lt(documents.id, after.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(documents.createdAt), desc(documents.id))
      .limit(page.limit);
    return rows.map(toView);
  }

  /** Whether the document exists in this tenant in any status (for idempotent deletes). */
  async existsById(scope: TenantScope, documentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, scope.organizationId),
          eq(documents.id, documentId),
        ),
      );
    return row !== undefined;
  }

  /**
   * Makes the document non-retrievable immediately (DELETING) and cancels any
   * not-yet-started ingestion. Cleanup of chunks and the object is asynchronous.
   * Returns false when the document was already deleting/deleted.
   */
  async markDeletingById(
    scope: TenantScope,
    documentId: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(documents)
        .set({ status: 'DELETING' })
        .where(
          and(
            eq(documents.organizationId, scope.organizationId),
            eq(documents.id, documentId),
            notInArray(documents.status, REMOVED_STATUSES),
          ),
        )
        .returning({ id: documents.id });
      if (updated.length === 0) return false;
      await tx
        .update(ingestionJobs)
        .set({ status: 'CANCELLED', completedAt: new Date() })
        .where(
          and(
            eq(ingestionJobs.organizationId, scope.organizationId),
            eq(ingestionJobs.documentId, documentId),
            inArray(ingestionJobs.status, ['QUEUED']),
          ),
        );
      return true;
    });
  }
}
