import mammoth from 'mammoth';
import {
  type DocumentExtractor,
  ExtractionError,
  type ExtractedSegment,
} from './extractor.js';

// Decompression limits for the ZIP container (zip-bomb protection).
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5000;

const OLE_SIGNATURE = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

/**
 * DOCX text grouped by heading sections (section-path locators). Images are
 * discarded; only text is extracted.
 */
export class DocxExtractor implements DocumentExtractor {
  readonly mimeType =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  async extract(content: Buffer): Promise<ExtractedSegment[]> {
    // Password-protected Office documents are OLE containers, not ZIP packages.
    if (content.subarray(0, 8).equals(OLE_SIGNATURE)) {
      throw new ExtractionError('EXTRACTION_ENCRYPTED');
    }
    assertZipWithinLimits(content);

    let html: string;
    try {
      ({ value: html } = await mammoth.convertToHtml(
        { buffer: content },
        { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) },
      ));
    } catch {
      throw new ExtractionError('EXTRACTION_UNREADABLE');
    }
    return toSections(html);
  }
}

/** Groups mammoth's block-level HTML into one segment per heading section. */
function toSections(html: string): ExtractedSegment[] {
  const segments: ExtractedSegment[] = [];
  const headings: string[] = [];
  let current: { section: string | undefined; parts: string[] } = {
    section: undefined,
    parts: [],
  };
  const flush = () => {
    if (current.parts.length > 0) {
      segments.push({
        text: current.parts.join('\n\n'),
        locator: current.section ? { section: current.section } : {},
      });
    }
  };

  const blocks = /<(h[1-6]|p|li|td|th)\b[^>]*>([\s\S]*?)<\/\1>/g;
  for (const [, tag, inner] of html.matchAll(blocks)) {
    const text = decodeEntities(inner!.replace(/<[^>]*>/g, ' ')).trim();
    if (!text) continue;
    if (tag!.startsWith('h')) {
      flush();
      const level = Number(tag!.slice(1));
      headings.length = level - 1;
      headings[level - 1] = text;
      current = {
        section: headings.filter(Boolean).join(' > '),
        parts: [text],
      };
    } else {
      current.parts.push(text);
    }
  }
  flush();
  return segments;
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi,
    (_, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith('#x'))
        return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith('#'))
        return String.fromCodePoint(parseInt(lower.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[lower] ?? '';
    },
  );
}

/**
 * Reads the ZIP central directory and rejects archives whose declared
 * uncompressed size or entry count exceeds the limits, before decompressing.
 */
export function assertZipWithinLimits(content: Buffer): void {
  const eocd = content.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > content.length) {
    throw new ExtractionError('EXTRACTION_UNREADABLE');
  }
  const entries = content.readUInt16LE(eocd + 10);
  let offset = content.readUInt32LE(eocd + 16);
  if (
    entries === 0xffff ||
    offset === 0xffffffff ||
    entries > MAX_ZIP_ENTRIES
  ) {
    throw new ExtractionError('EXTRACTION_TOO_LARGE');
  }

  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (
      offset + 46 > content.length ||
      content.readUInt32LE(offset) !== 0x02014b50
    ) {
      throw new ExtractionError('EXTRACTION_UNREADABLE');
    }
    const size = content.readUInt32LE(offset + 24);
    if (size === 0xffffffff) throw new ExtractionError('EXTRACTION_TOO_LARGE');
    total += size;
    if (total > MAX_UNCOMPRESSED_BYTES) {
      throw new ExtractionError('EXTRACTION_TOO_LARGE');
    }
    offset +=
      46 +
      content.readUInt16LE(offset + 28) +
      content.readUInt16LE(offset + 30) +
      content.readUInt16LE(offset + 32);
  }
}
