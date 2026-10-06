/** Where a piece of text came from, for citations (TDD §17). */
export interface SourceLocator {
  page?: number;
  /** Heading path, e.g. "Leave Policy > Annual Leave". */
  section?: string;
}

/** A run of extracted text sharing one locator (a page, or a section). */
export interface ExtractedSegment {
  text: string;
  locator: SourceLocator;
}

/**
 * Turns a stored original into text segments. Implementations must treat the
 * content as untrusted: no code execution, bounded resource use, no network.
 */
export interface DocumentExtractor {
  readonly mimeType: string;
  extract(content: Buffer): Promise<ExtractedSegment[]>;
}

export type ExtractionErrorCode =
  | 'EXTRACTION_EMPTY'
  | 'EXTRACTION_UNREADABLE'
  | 'EXTRACTION_ENCRYPTED'
  | 'EXTRACTION_TOO_LARGE'
  | 'EXTRACTION_UNSUPPORTED_TYPE';

/** A classified, non-retryable extraction failure. `code` is safe to show users. */
export class ExtractionError extends Error {
  constructor(readonly code: ExtractionErrorCode) {
    super(code);
    this.name = 'ExtractionError';
  }
}
