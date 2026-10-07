import { mergeAndSelect } from './retrieval-hit.js';
import type { ChunkMatch } from './retrieval.repository.js';

let next = 0;
function match(overrides: Partial<ChunkMatch>): ChunkMatch {
  next++;
  return {
    chunkId: `c${String(next).padStart(3, '0')}`,
    documentId: 'doc-a',
    documentName: 'A.pdf',
    chunkIndex: 0,
    content: 'text',
    pageNumber: null,
    sectionPath: null,
    charStart: 0,
    charEnd: 4,
    score: 0.5,
    ...overrides,
  };
}

const limits = { maxHits: 5, maxPerDocument: 3 };

describe('mergeAndSelect (E4-T02)', () => {
  it('returns a stable contract with IDs, score and locator metadata', () => {
    const hits = mergeAndSelect(
      [
        match({
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          documentName: 'Handbook.pdf',
          content: 'Annual leave is 25 days.',
          pageNumber: 4,
          charStart: 10,
          charEnd: 34,
          score: 0.83,
        }),
      ],
      limits,
    );

    expect(hits).toEqual([
      {
        chunkIds: ['chunk-1'],
        documentId: 'doc-1',
        documentName: 'Handbook.pdf',
        content: 'Annual leave is 25 days.',
        score: 0.83,
        locator: { page: 4, section: null, charStart: 10, charEnd: 34 },
      },
    ]);
  });

  it('merges adjacent overlapping chunks without repeating the overlap', () => {
    // Source text: "Leave is 25 days. Carry over 5 days. Expires in March."
    const hits = mergeAndSelect(
      [
        match({
          chunkIndex: 1,
          content: 'Carry over 5 days. Expires in March.',
          charStart: 18,
          charEnd: 54,
          score: 0.7,
        }),
        match({
          chunkIndex: 0,
          content: 'Leave is 25 days. Carry over',
          charStart: 0,
          charEnd: 28,
          score: 0.9,
        }),
      ],
      limits,
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      content: 'Leave is 25 days. Carry over 5 days. Expires in March.',
      score: 0.9,
      locator: { charStart: 0, charEnd: 54 },
    });
    expect(hits[0]!.chunkIds).toHaveLength(2);
  });

  it('does not merge across pages, sections, documents or gaps', () => {
    const hits = mergeAndSelect(
      [
        match({ chunkIndex: 0, pageNumber: 1, charStart: 0, charEnd: 10 }),
        match({ chunkIndex: 1, pageNumber: 2, charStart: 0, charEnd: 10 }),
        match({ chunkIndex: 2, sectionPath: 'A', charStart: 0, charEnd: 10 }),
        match({ chunkIndex: 3, sectionPath: 'B', charStart: 0, charEnd: 10 }),
        match({
          documentId: 'doc-b',
          chunkIndex: 5,
          charStart: 0,
          charEnd: 10,
        }),
        match({
          documentId: 'doc-b',
          chunkIndex: 7,
          charStart: 5,
          charEnd: 15,
        }),
      ],
      { maxHits: 10, maxPerDocument: 10 },
    );

    expect(hits).toHaveLength(6);
    expect(hits.every((h) => h.chunkIds.length === 1)).toBe(true);
  });

  it('caps hits per document so one document cannot dominate', () => {
    const hits = mergeAndSelect(
      [
        ...[0, 2, 4, 6, 8].map((chunkIndex, i) =>
          match({ documentId: 'big', chunkIndex, score: 0.9 - i * 0.01 }),
        ),
        match({ documentId: 'other', score: 0.6 }),
      ],
      { maxHits: 5, maxPerDocument: 3 },
    );

    expect(hits.map((h) => h.documentId)).toEqual([
      'big',
      'big',
      'big',
      'other',
    ]);
  });

  it('bounds the number of hits and orders them by score', () => {
    const hits = mergeAndSelect(
      [0.2, 0.9, 0.5, 0.7, 0.3, 0.8].map((score, i) =>
        match({ documentId: `d${i}`, score }),
      ),
      { maxHits: 3, maxPerDocument: 3 },
    );

    expect(hits.map((h) => h.score)).toEqual([0.9, 0.8, 0.7]);
  });

  it('returns nothing for no matches', () => {
    expect(mergeAndSelect([], limits)).toEqual([]);
  });
});
