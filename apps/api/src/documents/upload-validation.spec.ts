import { SUPPORTED_DOCUMENT_MIME_TYPES } from '@cka/config';
import {
  FILENAME_MAX_LENGTH,
  resolveDocumentType,
  sanitizeFilename,
} from './upload-validation.js';

const PDF = 'application/pdf';
const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ALL = SUPPORTED_DOCUMENT_MIME_TYPES;
const pdfBytes = Buffer.from('%PDF-1.7\n...');
const docxBytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('....word/document.xml....'),
]);
const txtBytes = Buffer.from('Plain UTF-8 text — café');

describe('sanitizeFilename', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['../../etc/passwd.txt', 'passwd.txt'],
    ['C:\\Users\\me\\notes.txt', 'notes.txt'],
    ['  spaced\tname .txt ', 'spaced name .txt'],
    ['evil\u202Etxt.exe.pdf', 'eviltxt.exe.pdf'],
    ['line\nbreak\u0000.txt', 'line break.txt'],
    ['', ''],
    ['../', ''],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('bounds the length but keeps the extension', () => {
    const result = sanitizeFilename(`${'a'.repeat(400)}.docx`);

    expect(result).toHaveLength(FILENAME_MAX_LENGTH);
    expect(result.endsWith('.docx')).toBe(true);
  });
});

describe('resolveDocumentType', () => {
  it.each([
    ['a.pdf', PDF, pdfBytes, PDF],
    ['a.PDF', 'application/octet-stream', pdfBytes, PDF],
    ['a.docx', DOCX, docxBytes, DOCX],
    ['a.txt', 'text/plain; charset=utf-8', txtBytes, 'text/plain'],
  ])('accepts %s declared as %s', (name, declared, bytes, expected) => {
    expect(resolveDocumentType(name, declared, bytes, ALL)).toBe(expected);
  });

  it.each([
    ['unsupported extension', 'a.exe', 'application/octet-stream', pdfBytes],
    ['no extension', 'pdf', PDF, pdfBytes],
    ['legacy .doc', 'a.doc', 'application/msword', docxBytes],
    ['mismatched declared type', 'a.pdf', 'text/html', pdfBytes],
    ['executable renamed to .pdf', 'a.pdf', PDF, Buffer.from('MZ\x90\x00')],
    [
      'plain zip renamed to .docx',
      'a.docx',
      DOCX,
      Buffer.from('PK\x03\x04abc'),
    ],
    [
      'binary data as .txt',
      'a.txt',
      'text/plain',
      Buffer.from([0x61, 0, 0x62]),
    ],
    ['invalid UTF-8 as .txt', 'a.txt', 'text/plain', Buffer.from([0xc3, 0x28])],
  ])('rejects %s', (_, name, declared, bytes) => {
    expect(() => resolveDocumentType(name, declared, bytes, ALL)).toThrow(
      expect.objectContaining({
        code: 'DOCUMENT_UNSUPPORTED_TYPE',
        status: 400,
      }),
    );
  });

  it('honours the configured allow-list', () => {
    expect(() =>
      resolveDocumentType('a.pdf', PDF, pdfBytes, ['text/plain']),
    ).toThrow(expect.objectContaining({ code: 'DOCUMENT_UNSUPPORTED_TYPE' }));
  });
});
