import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  type DocumentExtractor,
  ExtractionError,
  type ExtractedSegment,
} from './extractor.js';

const MAX_PAGES = 2000;

interface TextItem {
  str?: string;
  hasEOL?: boolean;
}

/**
 * Machine-readable PDF text, one segment per page (page-number locators).
 * pdf.js 6 never evaluates code (no eval/new Function); font loading and
 * auto-fetching are disabled. Scanned (image-only)
 * PDFs yield no text and are classified empty: OCR is out of MVP scope.
 */
export class PdfExtractor implements DocumentExtractor {
  readonly mimeType = 'application/pdf';

  async extract(content: Buffer): Promise<ExtractedSegment[]> {
    const task = getDocument({
      data: new Uint8Array(content),
      disableFontFace: true,
      useSystemFonts: false,
      disableAutoFetch: true,
      verbosity: 0,
    });
    let pdf;
    try {
      pdf = await task.promise;
    } catch (error) {
      await task.destroy();
      if (error instanceof Error && error.name === 'PasswordException') {
        throw new ExtractionError('EXTRACTION_ENCRYPTED');
      }
      throw new ExtractionError('EXTRACTION_UNREADABLE');
    }

    try {
      if (pdf.numPages > MAX_PAGES) {
        throw new ExtractionError('EXTRACTION_TOO_LARGE');
      }
      const segments: ExtractedSegment[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = (textContent.items as TextItem[])
          .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ''))
          .join('');
        page.cleanup();
        segments.push({ text, locator: { page: pageNumber } });
      }
      return segments;
    } catch (error) {
      if (error instanceof ExtractionError) throw error;
      throw new ExtractionError('EXTRACTION_UNREADABLE');
    } finally {
      await task.destroy();
    }
  }
}
