import {
  type DocumentExtractor,
  ExtractionError,
  type ExtractedSegment,
} from './extractor.js';
import { hasUsableText, normalizeText } from './normalize.js';

/**
 * Selects the extractor by the document's validated MIME type, normalizes the
 * text, drops unusable segments and rejects documents without usable text.
 */
export async function extractDocument(
  extractors: readonly DocumentExtractor[],
  mimeType: string,
  content: Buffer,
): Promise<ExtractedSegment[]> {
  const extractor = extractors.find((e) => e.mimeType === mimeType);
  if (!extractor) throw new ExtractionError('EXTRACTION_UNSUPPORTED_TYPE');

  const segments = (await extractor.extract(content))
    .map((segment) => ({ ...segment, text: normalizeText(segment.text) }))
    .filter((segment) => hasUsableText(segment.text));
  if (segments.length === 0) throw new ExtractionError('EXTRACTION_EMPTY');
  return segments;
}
