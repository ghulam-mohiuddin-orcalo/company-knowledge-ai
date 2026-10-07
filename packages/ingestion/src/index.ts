// Pure document ingestion steps (no framework, no I/O beyond the given bytes):
// extraction, normalization and token-aware chunking. Used by the worker and by
// the RAG evaluation harness. Backend-only; never import into apps/web.
import { DocxExtractor } from './extraction/docx-extractor.js';
import type { DocumentExtractor } from './extraction/extractor.js';
import { PdfExtractor } from './extraction/pdf-extractor.js';
import { TextExtractor } from './extraction/text-extractor.js';

export {
  type Chunk,
  chunkSegments,
  type ChunkingOptions,
} from './chunking/chunker.js';
export {
  cl100kTokenCounter,
  type TokenCounter,
} from './chunking/token-counter.js';
export { extractDocument } from './extraction/extract-document.js';
export {
  type DocumentExtractor,
  type ExtractedSegment,
  ExtractionError,
  type ExtractionErrorCode,
  type SourceLocator,
} from './extraction/extractor.js';
export { hasUsableText, normalizeText } from './extraction/normalize.js';
export { DocxExtractor, PdfExtractor, TextExtractor };

/** Extractors for every supported document type. */
export function createExtractors(): DocumentExtractor[] {
  return [new TextExtractor(), new PdfExtractor(), new DocxExtractor()];
}
