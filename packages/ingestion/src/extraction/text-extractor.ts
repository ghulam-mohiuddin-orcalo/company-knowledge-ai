import {
  type DocumentExtractor,
  ExtractionError,
  type ExtractedSegment,
} from './extractor.js';

/** UTF-8 plain text (BOM tolerated). Invalid encoding or binary data is unreadable. */
export class TextExtractor implements DocumentExtractor {
  readonly mimeType = 'text/plain';

  async extract(content: Buffer): Promise<ExtractedSegment[]> {
    if (content.includes(0)) throw new ExtractionError('EXTRACTION_UNREADABLE');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
        content,
      );
    } catch {
      throw new ExtractionError('EXTRACTION_UNREADABLE');
    }
    return [{ text, locator: {} }];
  }
}
