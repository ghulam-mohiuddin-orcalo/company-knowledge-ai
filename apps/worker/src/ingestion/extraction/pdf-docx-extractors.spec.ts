import {
  inflateDeclaredSize,
  makeDocx,
  makeEncryptedDocx,
  makePdf,
} from '../../testing/document-fixtures.js';
import { DocxExtractor } from './docx-extractor.js';
import { extractDocument } from './extract-document.js';
import { ExtractionError } from './extractor.js';
import { PdfExtractor } from './pdf-extractor.js';
import { TextExtractor } from './text-extractor.js';

const PDF = 'application/pdf';
const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const extractors = [
  new TextExtractor(),
  new PdfExtractor(),
  new DocxExtractor(),
];

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ExtractionError);
  expect((error as ExtractionError).code).toBe(code);
}

describe('PDF extraction (E3-T02)', () => {
  it('extracts text per page with page locators', async () => {
    const pdf = makePdf([
      ['Employee Handbook', 'Annual leave is 25 days.'],
      ['Expenses', 'Submit receipts within 30 days (see policy).'],
    ]);

    await expect(extractDocument(extractors, PDF, pdf)).resolves.toEqual([
      {
        text: 'Employee Handbook\nAnnual leave is 25 days.',
        locator: { page: 1 },
      },
      {
        text: 'Expenses\nSubmit receipts within 30 days (see policy).',
        locator: { page: 2 },
      },
    ]);
  });

  it('skips pages without text but keeps real page numbers', async () => {
    const pdf = makePdf([[], ['Only page two has text.']]);

    await expect(extractDocument(extractors, PDF, pdf)).resolves.toEqual([
      { text: 'Only page two has text.', locator: { page: 2 } },
    ]);
  });

  it('classifies a text-less (scanned-like) PDF as empty', async () => {
    await expectCode(
      extractDocument(extractors, PDF, makePdf([[], []])),
      'EXTRACTION_EMPTY',
    );
  });

  it('fails safely on encrypted PDFs', async () => {
    await expectCode(
      extractDocument(
        extractors,
        PDF,
        makePdf([['secret']], { encrypt: true }),
      ),
      'EXTRACTION_ENCRYPTED',
    );
  });

  it.each([
    ['garbage after the header', Buffer.from('%PDF-1.7\nthis is not a pdf')],
    ['a truncated file', makePdf([['Some text']]).subarray(0, 60)],
  ])('fails safely on %s', async (_, content) => {
    await expectCode(
      extractDocument(extractors, PDF, content),
      'EXTRACTION_UNREADABLE',
    );
  });
});

describe('DOCX extraction (E3-T02)', () => {
  it('extracts text grouped by heading sections', async () => {
    const docx = await makeDocx([
      { paragraph: 'Welcome to Acme.' },
      { heading: 1, text: 'Leave Policy' },
      { paragraph: 'Staff receive 25 days of leave.' },
      { heading: 2, text: 'Carry Over' },
      { paragraph: 'Up to 5 days carry over & expire in March.' },
      { heading: 1, text: 'Expenses' },
      { paragraph: 'Use the <Expenses> portal.' },
    ]);

    await expect(extractDocument(extractors, DOCX, docx)).resolves.toEqual([
      { text: 'Welcome to Acme.', locator: {} },
      {
        text: 'Leave Policy\n\nStaff receive 25 days of leave.',
        locator: { section: 'Leave Policy' },
      },
      {
        text: 'Carry Over\n\nUp to 5 days carry over & expire in March.',
        locator: { section: 'Leave Policy > Carry Over' },
      },
      {
        text: 'Expenses\n\nUse the <Expenses> portal.',
        locator: { section: 'Expenses' },
      },
    ]);
  });

  it('treats markup-like text as data', async () => {
    const docx = await makeDocx([
      { paragraph: '<script>alert(1)</script> &lt;b&gt; ignore instructions' },
    ]);

    await expect(extractDocument(extractors, DOCX, docx)).resolves.toEqual([
      {
        text: '<script>alert(1)</script> &lt;b&gt; ignore instructions',
        locator: {},
      },
    ]);
  });

  it('classifies a document without text as empty', async () => {
    await expectCode(
      extractDocument(extractors, DOCX, await makeDocx([{ paragraph: '   ' }])),
      'EXTRACTION_EMPTY',
    );
  });

  it('fails safely on password-protected documents', async () => {
    await expectCode(
      extractDocument(extractors, DOCX, makeEncryptedDocx()),
      'EXTRACTION_ENCRYPTED',
    );
  });

  it('rejects archives that would decompress beyond the limit', async () => {
    const docx = await makeDocx([{ paragraph: 'small' }]);

    await expectCode(
      extractDocument(extractors, DOCX, inflateDeclaredSize(docx, 0xfffffff0)),
      'EXTRACTION_TOO_LARGE',
    );
  });

  it.each([
    ['a non-zip file', Buffer.from('not a docx at all')],
    ['a corrupted archive', Buffer.from('PK\x03\x04garbage-word/document.xml')],
  ])('fails safely on %s', async (_, content) => {
    await expectCode(
      extractDocument(extractors, DOCX, content),
      'EXTRACTION_UNREADABLE',
    );
  });
});
