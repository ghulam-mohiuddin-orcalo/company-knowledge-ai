import JSZip from 'jszip';

/**
 * Deterministic document fixtures built in code (no binary files in the repo).
 * Text is ASCII so expected extraction output is exact.
 */

function pdfString(text: string): string {
  return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/**
 * A machine-readable PDF: one page per entry, each a list of text lines.
 * `encrypt` adds a Standard security handler whose password check fails.
 */
export function makePdf(
  pages: string[][],
  options: { encrypt?: boolean } = {},
): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font, then (page, content) pairs, then optional encrypt.
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = [
      'BT /F1 12 Tf 14 TL 72 720 Td',
      ...lines.map((line, n) => `${n === 0 ? '' : 'T* '}${pdfString(line)} Tj`),
      'ET',
    ].join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] ` +
    `/Count ${pages.length} >>`;
  let encryptId: number | undefined;
  if (options.encrypt) {
    encryptId = objects.length;
    const bogus = `<${'ab'.repeat(32)}>`;
    objects[encryptId] =
      `<< /Filter /Standard /V 1 /R 2 /O ${bogus} /U ${bogus} /P -4 >>`;
  }

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  const id = `<${'cd'.repeat(16)}>`;
  body +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R` +
    (encryptId ? ` /Encrypt ${encryptId} 0 R /ID [${id} ${id}]` : '') +
    ` >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

export type DocxBlock =
  { heading: 1 | 2 | 3; text: string } | { paragraph: string };

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** A minimal but valid DOCX with heading styles and paragraphs. */
export async function makeDocx(blocks: DocxBlock[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
  );
  const headingStyles = [1, 2, 3]
    .map(
      (level) =>
        `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/></w:style>`,
    )
    .join('');
  zip.file(
    'word/styles.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      headingStyles +
      '</w:styles>',
  );
  const paragraphs = blocks
    .map((block) => {
      const style =
        'heading' in block
          ? `<w:pPr><w:pStyle w:val="Heading${block.heading}"/></w:pPr>`
          : '';
      const text = 'heading' in block ? block.text : block.paragraph;
      return `<w:p>${style}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
    })
    .join('');
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${paragraphs}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Password-protected Office files are OLE compound files, not ZIP packages. */
export function makeEncryptedDocx(): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(504),
  ]);
}

/** Rewrites a ZIP's central directory so one entry claims a huge uncompressed size. */
export function inflateDeclaredSize(zip: Buffer, size: number): Buffer {
  const copy = Buffer.from(zip);
  const centralEntry = copy.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  copy.writeUInt32LE(size, centralEntry + 24);
  return copy;
}
