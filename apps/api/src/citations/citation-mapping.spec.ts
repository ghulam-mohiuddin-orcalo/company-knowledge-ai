import { buildRagPrompt } from '../rag/prompt-builder.js';
import type { RetrievalHit } from '../retrieval/retrieval-hit.js';
import { mapCitations } from './citation-mapping.js';

const hit = (n: number, extra: Partial<RetrievalHit> = {}): RetrievalHit => ({
  chunkIds: [`chunk-${n}`, `chunk-${n}b`],
  documentId: `doc-${n}`,
  documentName: `Doc ${n}.pdf`,
  content: `evidence ${n}`,
  score: 0.9,
  locator: { page: n, section: null, charStart: n, charEnd: n + 10 },
  ...extra,
});

describe('mapCitations (E6-T02)', () => {
  const { sources } = buildRagPrompt('q', [hit(1), hit(2), hit(3)]);

  it('maps recognized labels to the retrieval hits sent in the prompt, numbered by first appearance', () => {
    const mapped = mapCitations(
      'Travel is booked centrally [SOURCE_3]. Leave is 27 days [SOURCE_1][SOURCE_3].',
      sources,
    );

    expect(mapped.text).toBe(
      'Travel is booked centrally [1]. Leave is 27 days [2][1].',
    );
    expect(mapped.citations).toEqual([
      {
        ordinal: 1,
        sourceLabel: 'SOURCE_3',
        documentId: 'doc-3',
        chunkId: 'chunk-3',
        locator: { page: 3, section: null, charStart: 3, charEnd: 13 },
      },
      {
        ordinal: 2,
        sourceLabel: 'SOURCE_1',
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        locator: { page: 1, section: null, charStart: 1, charEnd: 11 },
      },
    ]);
  });

  it('drops labels that were not in the prompt', () => {
    const mapped = mapCitations(
      'A [SOURCE_9] B [SOURCE_0] C [SOURCE_2].',
      sources,
    );

    expect(mapped.text).toBe('A B C [1].');
    expect(mapped.citations.map((c) => c.sourceLabel)).toEqual(['SOURCE_2']);
  });

  it('never turns model-written identifiers into citations', () => {
    const forged =
      'See [doc:11111111-1111-4111-8111-111111111111] (chunk 2222) ' +
      '[SOURCE_1](https://evil.test/doc-1) [source_2] [SOURCE_2 ] {"documentId":"doc-x"}';

    const mapped = mapCitations(forged, sources);

    expect(mapped.citations).toEqual([
      expect.objectContaining({
        ordinal: 1,
        documentId: 'doc-1',
        chunkId: 'chunk-1',
      }),
    ]);
    for (const citation of mapped.citations) {
      expect(['doc-1', 'doc-2', 'doc-3']).toContain(citation.documentId);
    }
  });

  it('returns no citations when nothing valid is cited', () => {
    expect(mapCitations('No labels here.', sources)).toEqual({
      text: 'No labels here.',
      citations: [],
    });
  });
});
