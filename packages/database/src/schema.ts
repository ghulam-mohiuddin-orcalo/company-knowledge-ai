import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

// Source of truth for the database schema. Changes must go through a generated,
// reviewed migration (`pnpm db:generate`); schema push/auto-sync is never used.

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const organizationStatus = pgEnum('organization_status', [
  'ACTIVE',
  'SUSPENDED',
]);

// Tenant-scoped roles. Platform administration is not an organization membership.
export const membershipRole = pgEnum('membership_role', [
  'MEMBER',
  'ORG_ADMIN',
]);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: organizationStatus('status').notNull().default('ACTIVE'),
  ...timestamps,
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  authSubject: text('auth_subject').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  // Platform operator (cross-tenant operations). Not an organization role and never
  // derived from identity-provider claims; granted only through controlled database operations.
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  ...timestamps,
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: membershipRole('role').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('memberships_organization_id_user_id_key').on(
      table.organizationId,
      table.userId,
    ),
    index('memberships_user_id_organization_id_idx').on(
      table.userId,
      table.organizationId,
    ),
    index('memberships_organization_id_role_idx').on(
      table.organizationId,
      table.role,
    ),
  ],
);

// Document lifecycle (TDD §10): QUEUED -> PROCESSING -> READY | FAILED;
// any state -> DELETING (immediately non-retrievable) -> DELETED after cleanup.
export const documentStatus = pgEnum('document_status', [
  'QUEUED',
  'PROCESSING',
  'READY',
  'FAILED',
  'DELETING',
  'DELETED',
]);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // Original filename for display only; never used as a storage path.
    filename: text('filename').notNull(),
    // Server-generated object key (tenant/document prefixed). Never returned to clients.
    storageKey: text('storage_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256'),
    status: documentStatus('status').notNull().default('QUEUED'),
    // Safe, classified error code (no internal details).
    errorCode: text('error_code'),
    ...timestamps,
  },
  (table) => [
    index('documents_organization_id_status_created_at_idx').on(
      table.organizationId,
      table.status,
      table.createdAt.desc(),
    ),
    check('documents_size_bytes_positive', sql`${table.sizeBytes} > 0`),
    // Target for composite FKs that keep child rows in the document's tenant.
    unique('documents_id_organization_id_key').on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const ingestionJobStatus = pgEnum('ingestion_job_status', [
  'QUEUED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);

export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id').notNull(),
    status: ingestionJobStatus('status').notNull().default('QUEUED'),
    attempt: integer('attempt').notNull().default(0),
    // One ingestion job per document upload (prevents duplicate enqueueing).
    idempotencyKey: text('idempotency_key').notNull().unique(),
    // Earliest time the job may be claimed (retry backoff).
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Set on each claim; only the current claim holder may complete the job.
    claimToken: uuid('claim_token'),
    // A PROCESSING job whose lease expired (worker crash) may be reclaimed.
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    errorDetailSafe: text('error_detail_safe'),
    ...timestamps,
  },
  (table) => [
    index('ingestion_jobs_status_next_attempt_at_idx').on(
      table.status,
      table.nextAttemptAt,
    ),
    index('ingestion_jobs_organization_id_document_id_idx').on(
      table.organizationId,
      table.documentId,
    ),
    check('ingestion_jobs_attempt_non_negative', sql`${table.attempt} >= 0`),
    // A job always belongs to its document's organization.
    foreignKey({
      name: 'ingestion_jobs_document_tenant_fk',
      columns: [table.documentId, table.organizationId],
      foreignColumns: [documents.id, documents.organizationId],
    }).onDelete('restrict'),
  ],
);

/**
 * Embedding dimension of the configured model (text-embedding-3-small). The
 * column type enforces it; changing models requires a migration and re-indexing.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    documentId: uuid('document_id').notNull(),
    // The ingestion job that produced this chunk set (traceability).
    ingestionJobId: uuid('ingestion_job_id')
      .notNull()
      .references(() => ingestionJobs.id, { onDelete: 'restrict' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    pageNumber: integer('page_number'),
    sectionPath: text('section_path'),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    embedding: vector('embedding', {
      dimensions: EMBEDDING_DIMENSIONS,
    }).notNull(),
    embeddingModel: text('embedding_model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One active chunk set per document: retries cannot duplicate chunks.
    unique('document_chunks_document_id_chunk_index_key').on(
      table.documentId,
      table.chunkIndex,
    ),
    index('document_chunks_organization_id_document_id_idx').on(
      table.organizationId,
      table.documentId,
    ),
    // A chunk always belongs to its document's organization.
    foreignKey({
      name: 'document_chunks_document_tenant_fk',
      columns: [table.documentId, table.organizationId],
      foreignColumns: [documents.id, documents.organizationId],
    }).onDelete('restrict'),
    check(
      'document_chunks_chunk_index_non_negative',
      sql`${table.chunkIndex} >= 0`,
    ),
    check('document_chunks_token_count_positive', sql`${table.tokenCount} > 0`),
    check(
      'document_chunks_char_range_valid',
      sql`${table.charStart} >= 0 AND ${table.charEnd} >= ${table.charStart}`,
    ),
    // Exact search is used for the MVP; an ANN index is added only when corpus
    // size/latency requires it (TDD §9.1).
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // Owner: MVP conversations are private to the user who created them.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text('title'),
    ...timestamps,
  },
  (table) => [
    index('conversations_organization_id_user_id_updated_at_idx').on(
      table.organizationId,
      table.userId,
      table.updatedAt.desc(),
    ),
    unique('conversations_id_organization_id_key').on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const messageRole = pgEnum('message_role', ['USER', 'ASSISTANT']);

// Assistant outcome: a grounded answer, or the explicit no-answer response.
export const messageOutcome = pgEnum('message_outcome', [
  'ANSWERED',
  'NO_ANSWER',
]);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    role: messageRole('role').notNull(),
    content: text('content').notNull(),
    outcome: messageOutcome('outcome'),
    // The user message an assistant message answers (one reply per question).
    replyToMessageId: uuid('reply_to_message_id').unique(
      'messages_reply_to_message_id_key',
    ),
    // Client idempotency key for user messages (retries return the same exchange).
    requestId: text('request_id'),
    model: text('model'),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('messages_id_organization_id_key').on(
      table.id,
      table.organizationId,
    ),
    index('messages_conversation_id_created_at_idx').on(
      table.conversationId,
      table.createdAt,
    ),
    unique('messages_conversation_id_request_id_key').on(
      table.conversationId,
      table.requestId,
    ),
    // A message always belongs to its conversation's organization.
    foreignKey({
      name: 'messages_conversation_tenant_fk',
      columns: [table.conversationId, table.organizationId],
      foreignColumns: [conversations.id, conversations.organizationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'messages_reply_to_message_id_fk',
      columns: [table.replyToMessageId],
      foreignColumns: [table.id],
    }).onDelete('restrict'),
    check(
      'messages_role_fields_valid',
      sql`(${table.role} = 'USER' AND ${table.outcome} IS NULL AND ${table.replyToMessageId} IS NULL)
        OR (${table.role} = 'ASSISTANT' AND ${table.outcome} IS NOT NULL AND ${table.replyToMessageId} IS NOT NULL AND ${table.requestId} IS NULL)`,
    ),
  ],
);

/** Where cited evidence sits in its document (no document text). */
export interface CitationLocator {
  page: number | null;
  section: string | null;
  charStart: number;
  charEnd: number;
}

/**
 * Server-created citation records (TDD §17, E6). Rows are created only from the
 * retrieval hits used for the answer, never from model output. Excerpts are
 * not copied here: they are read from the live chunk, so deleting a document
 * removes its text from citations too.
 */
export const answerCitations = pgTable(
  'answer_citations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    messageId: uuid('message_id').notNull(),
    documentId: uuid('document_id').notNull(),
    // Nulled when deletion cleanup removes the chunk (the citation becomes unavailable).
    chunkId: uuid('chunk_id').references(() => documentChunks.id, {
      onDelete: 'set null',
    }),
    // Display order within the answer: [1], [2], ...
    ordinal: integer('ordinal').notNull(),
    // The transient prompt label the model cited (e.g. SOURCE_2), for traceability.
    sourceLabel: text('source_label').notNull(),
    locator: jsonb('locator').$type<CitationLocator>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('answer_citations_message_id_ordinal_key').on(
      table.messageId,
      table.ordinal,
    ),
    unique('answer_citations_message_id_source_label_key').on(
      table.messageId,
      table.sourceLabel,
    ),
    index('answer_citations_organization_id_document_id_idx').on(
      table.organizationId,
      table.documentId,
    ),
    // Citations always belong to the message's and the document's organization.
    foreignKey({
      name: 'answer_citations_message_tenant_fk',
      columns: [table.messageId, table.organizationId],
      foreignColumns: [messages.id, messages.organizationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'answer_citations_document_tenant_fk',
      columns: [table.documentId, table.organizationId],
      foreignColumns: [documents.id, documents.organizationId],
    }).onDelete('restrict'),
    check('answer_citations_ordinal_positive', sql`${table.ordinal} >= 1`),
  ],
);
