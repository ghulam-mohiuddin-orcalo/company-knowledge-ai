import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { EmbeddingProvider } from '@cka/ai';
import {
  type Database,
  documentChunks,
  documents,
  ingestionJobs,
} from '@cka/database';
import {
  type Chunk,
  type ChunkingOptions,
  chunkSegments,
  cl100kTokenCounter,
  createExtractors,
  extractDocument,
} from '@cka/ingestion';
import { type DocxBlock, makeDocx, makePdf } from '@cka/ingestion/fixtures';
import { documentObjectKey } from '@cka/storage';
import type { RetrievalHit } from '../retrieval/retrieval-hit.js';

/** The fixed evaluation corpus lives in docs/rag-evaluation (version-controlled). */
export const EVALUATION_DIR = new URL(
  '../../../../docs/rag-evaluation/',
  import.meta.url,
);

export type CorpusDocument = {
  id: string;
  filename: string;
} & (
  | { format: 'txt'; text: string }
  | { format: 'pdf'; pages: string[][] }
  | { format: 'docx'; blocks: DocxBlock[] }
);

export interface ExpectedSource {
  document: string;
  page?: number;
  section?: string;
}

export type EvaluationQuestion =
  | {
      id: string;
      question: string;
      answerable: true;
      expected: ExpectedSource[];
    }
  | { id: string; question: string; answerable: false };

export function loadCorpus(): {
  documents: CorpusDocument[];
  questions: EvaluationQuestion[];
} {
  const read = (name: string) =>
    JSON.parse(readFileSync(new URL(name, EVALUATION_DIR), 'utf8')) as Record<
      string,
      unknown
    >;
  return {
    documents: read('corpus.json').documents as CorpusDocument[],
    questions: read('questions.json').questions as EvaluationQuestion[],
  };
}

const MIME_TYPES = {
  txt: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/** Builds the original file bytes exactly as a user would upload them. */
export async function documentBytes(
  document: CorpusDocument,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const mimeType = MIME_TYPES[document.format];
  switch (document.format) {
    case 'txt':
      return { bytes: Buffer.from(document.text, 'utf8'), mimeType };
    case 'pdf':
      return { bytes: makePdf(document.pages), mimeType };
    case 'docx':
      return { bytes: await makeDocx(document.blocks), mimeType };
  }
}

/** Extracts and chunks a corpus document with the production ingestion steps. */
export async function chunkCorpusDocument(
  document: CorpusDocument,
  chunking: ChunkingOptions,
): Promise<Chunk[]> {
  const { bytes, mimeType } = await documentBytes(document);
  const segments = await extractDocument(createExtractors(), mimeType, bytes);
  return chunkSegments(segments, chunking, cl100kTokenCounter);
}

/**
 * Indexes the corpus for one tenant: production extraction and chunking, the
 * given embedding provider, READY documents. Returns corpus id -> document id.
 */
export async function indexCorpus(
  db: Database,
  tenant: { organizationId: string; uploadedBy: string },
  corpus: CorpusDocument[],
  embeddings: EmbeddingProvider,
  chunking: ChunkingOptions,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const document of corpus) {
    const { bytes, mimeType } = await documentBytes(document);
    const chunks = await chunkCorpusDocument(document, chunking);
    const vectors = await embeddings.embedTexts(chunks.map((c) => c.content));
    const documentId = randomUUID();
    ids.set(document.id, documentId);
    await db.transaction(async (tx) => {
      await tx.insert(documents).values({
        id: documentId,
        organizationId: tenant.organizationId,
        uploadedBy: tenant.uploadedBy,
        filename: document.filename,
        storageKey: documentObjectKey(tenant.organizationId, documentId),
        mimeType,
        sizeBytes: bytes.length,
        status: 'READY',
      });
      const [job] = await tx
        .insert(ingestionJobs)
        .values({
          organizationId: tenant.organizationId,
          documentId,
          idempotencyKey: `document:${documentId}:ingest`,
          status: 'SUCCEEDED',
          attempt: 1,
        })
        .returning();
      await tx.insert(documentChunks).values(
        chunks.map((chunk, i) => ({
          ...chunk,
          organizationId: tenant.organizationId,
          documentId,
          ingestionJobId: job!.id,
          embedding: vectors[i]!,
          embeddingModel: embeddings.model,
        })),
      );
    });
  }
  return ids;
}

/** Whether a hit is the expected source (same document and, if labelled, page/section). */
export function hitMatches(
  hit: RetrievalHit,
  expected: ExpectedSource,
  documentIds: Map<string, string>,
): boolean {
  return (
    hit.documentId === documentIds.get(expected.document) &&
    (expected.page === undefined || hit.locator.page === expected.page) &&
    (expected.section === undefined || hit.locator.section === expected.section)
  );
}
