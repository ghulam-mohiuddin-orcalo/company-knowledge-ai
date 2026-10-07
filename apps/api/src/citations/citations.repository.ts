import { Inject, Injectable } from '@nestjs/common';
import {
  answerCitations,
  type CitationLocator,
  conversations,
  type Database,
  documentChunks,
  documents,
  messages,
} from '@cka/database';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';
import type { TenantScope } from '../tenancy/tenant-scope.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** A citation to create, derived from a server-side retrieval hit. */
export interface NewCitation {
  ordinal: number;
  sourceLabel: string;
  documentId: string;
  chunkId: string;
  locator: CitationLocator;
}

/** A stored citation joined with its live evidence. */
export interface CitationView {
  id: string;
  messageId: string;
  ordinal: number;
  documentId: string;
  documentName: string;
  locator: CitationLocator;
  /** Cited chunk text; null when the evidence is no longer available. */
  chunkContent: string | null;
  /** The document is READY and the cited chunk still exists. */
  available: boolean;
}

/** Everything needed to serve a citation's source, after authorization. */
export interface CitationSource extends CitationView {
  mimeType: string;
  storageKey: string;
}

/** Thrown when cited evidence disappeared before the answer was stored. */
export class CitedEvidenceUnavailableError extends Error {
  constructor() {
    super('Cited evidence is no longer available');
    this.name = 'CitedEvidenceUnavailableError';
  }
}

const viewColumns = {
  id: answerCitations.id,
  messageId: answerCitations.messageId,
  ordinal: answerCitations.ordinal,
  documentId: answerCitations.documentId,
  documentName: documents.filename,
  documentStatus: documents.status,
  locator: answerCitations.locator,
  chunkContent: documentChunks.content,
  mimeType: documents.mimeType,
  storageKey: documents.storageKey,
};

type Row = {
  [K in keyof typeof viewColumns]: (typeof viewColumns)[K]['_']['data'] | null;
};

function toSource(row: Row): CitationSource {
  const available = row.documentStatus === 'READY' && row.chunkContent !== null;
  return {
    id: row.id!,
    messageId: row.messageId!,
    ordinal: row.ordinal!,
    documentId: row.documentId!,
    documentName: row.documentName!,
    locator: row.locator!,
    chunkContent: available ? row.chunkContent : null,
    available,
    mimeType: row.mimeType!,
    storageKey: row.storageKey!,
  };
}

/** Drops storage fields that must never leave the server. */
function toView(source: CitationSource): CitationView {
  return {
    id: source.id,
    messageId: source.messageId,
    ordinal: source.ordinal,
    documentId: source.documentId,
    documentName: source.documentName,
    locator: source.locator,
    chunkContent: source.chunkContent,
    available: source.available,
  };
}

/**
 * Citations are tenant-owned (TDD §17). They are created only from server-known
 * chunks of READY documents in the same organization, and resolved only for
 * the owner of the conversation they belong to.
 */
@Injectable()
export class CitationsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Creates citation rows inside the caller's transaction. Each row is copied
   * from the cited chunk itself (INSERT ... SELECT), so a row exists only when
   * that chunk, document and organization match and the document is READY.
   * Throws CitedEvidenceUnavailableError if any cited evidence is gone.
   */
  async insertForMessage(
    tx: Tx,
    scope: TenantScope,
    messageId: string,
    citations: readonly NewCitation[],
  ): Promise<void> {
    for (const citation of citations) {
      const inserted = await tx.execute(sql`
        INSERT INTO ${answerCitations}
          (organization_id, message_id, document_id, chunk_id, ordinal, source_label, locator)
        SELECT ${documentChunks.organizationId}, ${messageId}, ${documentChunks.documentId},
               ${documentChunks.id}, ${citation.ordinal}, ${citation.sourceLabel},
               ${JSON.stringify(citation.locator)}::jsonb
        FROM ${documentChunks}
        INNER JOIN ${documents}
          ON ${documents.id} = ${documentChunks.documentId}
         AND ${documents.organizationId} = ${documentChunks.organizationId}
        WHERE ${documentChunks.id} = ${citation.chunkId}
          AND ${documentChunks.documentId} = ${citation.documentId}
          AND ${documentChunks.organizationId} = ${scope.organizationId}
          AND ${documents.status} = 'READY'
        FOR SHARE OF ${documents}
      `);
      if (inserted.rowCount !== 1) throw new CitedEvidenceUnavailableError();
    }
  }

  /** Citations of the given (already authorized) messages, in ordinal order. */
  async listForMessages(
    scope: TenantScope,
    messageIds: readonly string[],
  ): Promise<CitationView[]> {
    if (messageIds.length === 0) return [];
    const rows = await this.db
      .select(viewColumns)
      .from(answerCitations)
      .innerJoin(
        documents,
        and(
          eq(documents.id, answerCitations.documentId),
          eq(documents.organizationId, answerCitations.organizationId),
        ),
      )
      .leftJoin(documentChunks, eq(documentChunks.id, answerCitations.chunkId))
      .where(
        and(
          eq(answerCitations.organizationId, scope.organizationId),
          inArray(answerCitations.messageId, [...messageIds]),
        ),
      )
      .orderBy(asc(answerCitations.messageId), asc(answerCitations.ordinal));
    return rows.map((row) => toView(toSource(row)));
  }

  /**
   * A citation in the caller's own conversation, with fresh tenant and owner
   * checks. Undefined for unknown, other users' or other tenants' citations.
   */
  async findOwnedById(
    scope: TenantScope,
    userId: string,
    citationId: string,
  ): Promise<CitationSource | undefined> {
    const [row] = await this.db
      .select(viewColumns)
      .from(answerCitations)
      .innerJoin(
        messages,
        and(
          eq(messages.id, answerCitations.messageId),
          eq(messages.organizationId, answerCitations.organizationId),
        ),
      )
      .innerJoin(
        conversations,
        and(
          eq(conversations.id, messages.conversationId),
          eq(conversations.organizationId, messages.organizationId),
        ),
      )
      .innerJoin(
        documents,
        and(
          eq(documents.id, answerCitations.documentId),
          eq(documents.organizationId, answerCitations.organizationId),
        ),
      )
      .leftJoin(documentChunks, eq(documentChunks.id, answerCitations.chunkId))
      .where(
        and(
          eq(answerCitations.organizationId, scope.organizationId),
          eq(answerCitations.id, citationId),
          eq(conversations.userId, userId),
        ),
      );
    return row ? toSource(row) : undefined;
  }
}
