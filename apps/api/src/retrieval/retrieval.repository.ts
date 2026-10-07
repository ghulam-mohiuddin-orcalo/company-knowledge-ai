import { Inject, Injectable } from '@nestjs/common';
import { type Database, documentChunks, documents } from '@cka/database';
import { and, asc, cosineDistance, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';
import type { TenantScope } from '../tenancy/tenant-scope.js';

/** A stored chunk matching a query, with cosine similarity in [-1, 1]. */
export interface ChunkMatch {
  chunkId: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  sectionPath: string | null;
  charStart: number;
  charEnd: number;
  score: number;
}

/**
 * Tenant-scoped vector search (TDD §14). The organization and READY-document
 * constraints are part of the SQL itself, so chunks of other tenants or of
 * documents that are processing, failed or being deleted can never be returned.
 * Exact (sequential) cosine search; parameterized query vector.
 */
@Injectable()
export class RetrievalRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async searchSimilarChunks(
    scope: TenantScope,
    queryVector: readonly number[],
    limit: number,
  ): Promise<ChunkMatch[]> {
    const distance = cosineDistance(documentChunks.embedding, [...queryVector]);
    const rows = await this.db
      .select({
        chunkId: documentChunks.id,
        documentId: documentChunks.documentId,
        documentName: documents.filename,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
        pageNumber: documentChunks.pageNumber,
        sectionPath: documentChunks.sectionPath,
        charStart: documentChunks.charStart,
        charEnd: documentChunks.charEnd,
        score: sql<number>`1 - (${distance})`.mapWith(Number),
      })
      .from(documentChunks)
      .innerJoin(
        documents,
        and(
          eq(documents.id, documentChunks.documentId),
          eq(documents.organizationId, documentChunks.organizationId),
        ),
      )
      .where(
        and(
          eq(documentChunks.organizationId, scope.organizationId),
          eq(documents.organizationId, scope.organizationId),
          eq(documents.status, 'READY'),
        ),
      )
      .orderBy(distance, asc(documentChunks.id))
      .limit(limit);
    return rows;
  }
}
