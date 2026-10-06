import type { ExtractedSegment } from '../extraction/extractor.js';
import { type Chunk, chunkSegments } from './chunker.js';
import { cl100kTokenCounter as counter } from './token-counter.js';

/** Deterministic prose: numbered sentences so every position is identifiable. */
function prose(sentences: number, prefix = 'S'): string {
  return Array.from(
    { length: sentences },
    (_, i) => `${prefix}${i} covers policy item ${i} in detail.`,
  ).join(' ');
}

function expectFaithful(chunks: Chunk[], segments: ExtractedSegment[]) {
  for (const chunk of chunks) {
    const segment = segments.find(
      (s) =>
        (s.locator.page ?? null) === chunk.pageNumber &&
        (s.locator.section ?? null) === chunk.sectionPath,
    )!;
    expect(segment.text.slice(chunk.charStart, chunk.charEnd)).toBe(
      chunk.content,
    );
    expect(counter.count(chunk.content)).toBe(chunk.tokenCount);
  }
}

describe('chunkSegments (E3-T03)', () => {
  const options = { sizeTokens: 60, overlapTokens: 12 };

  it('keeps a short segment as a single chunk', () => {
    const segments = [
      { text: 'Annual leave is 25 days.', locator: { page: 3 } },
    ];

    expect(chunkSegments(segments, options, counter)).toEqual([
      {
        chunkIndex: 0,
        content: 'Annual leave is 25 days.',
        tokenCount: counter.count('Annual leave is 25 days.'),
        pageNumber: 3,
        sectionPath: null,
        charStart: 0,
        charEnd: 24,
      },
    ]);
  });

  it('splits long text into chunks within the token limit, at word boundaries', () => {
    const segments = [{ text: prose(60), locator: {} }];

    const chunks = chunkSegments(segments, options, counter);

    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(options.sizeTokens);
      expect(chunk.content).not.toMatch(/^\s|\s$/);
    }
    expectFaithful(chunks, segments);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it('overlaps consecutive chunks by about the configured amount', () => {
    const segments = [{ text: prose(60), locator: {} }];

    const chunks = chunkSegments(segments, options, counter);

    for (let n = 1; n < chunks.length; n++) {
      const previous = chunks[n - 1]!;
      const current = chunks[n]!;
      expect(current.charStart).toBeGreaterThan(previous.charStart);
      expect(current.charStart).toBeLessThan(previous.charEnd);
      const shared = segments[0]!.text.slice(
        current.charStart,
        previous.charEnd,
      );
      expect(counter.count(shared)).toBeLessThanOrEqual(
        options.overlapTokens + 2,
      );
      expect(counter.count(shared)).toBeGreaterThan(0);
    }
  });

  it('covers every part of the text', () => {
    const text = prose(40);
    const chunks = chunkSegments([{ text, locator: {} }], options, counter);

    expect(chunks[0]!.charStart).toBe(0);
    expect(chunks.at(-1)!.charEnd).toBe(text.length);
    for (let n = 1; n < chunks.length; n++) {
      expect(chunks[n]!.charStart).toBeLessThanOrEqual(chunks[n - 1]!.charEnd);
    }
  });

  it('produces adjacent, non-overlapping chunks when overlap is 0', () => {
    const text = prose(30);
    const chunks = chunkSegments(
      [{ text, locator: {} }],
      { sizeTokens: 60, overlapTokens: 0 },
      counter,
    );

    for (let n = 1; n < chunks.length; n++) {
      expect(chunks[n]!.charStart).toBeGreaterThanOrEqual(
        chunks[n - 1]!.charEnd,
      );
    }
  });

  it('never crosses page or section boundaries and keeps their metadata', () => {
    const segments: ExtractedSegment[] = [
      { text: prose(12, 'P'), locator: { page: 1 } },
      { text: 'Short page two.', locator: { page: 2 } },
      { text: prose(12, 'Q'), locator: { section: 'Leave > Carry Over' } },
    ];

    const chunks = chunkSegments(segments, options, counter);

    expect(chunks.find((c) => c.content === 'Short page two.')).toMatchObject({
      pageNumber: 2,
      sectionPath: null,
    });
    expect(
      chunks.filter((c) => c.content.includes('P') && c.content.includes('Q')),
    ).toEqual([]);
    expect(new Set(chunks.map((c) => c.sectionPath))).toEqual(
      new Set([null, 'Leave > Carry Over']),
    );
    expectFaithful(chunks, segments);
  });

  it('splits words larger than a chunk (URLs, unspaced CJK text) safely', () => {
    const segments = [
      {
        text: `see https://example.test/${'a1b2'.repeat(200)} now`,
        locator: {},
      },
      { text: '東京都の就業規則'.repeat(40), locator: { page: 9 } },
      { text: '\u{1F600}'.repeat(200), locator: { page: 10 } },
    ];

    const chunks = chunkSegments(segments, options, counter);

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(options.sizeTokens);
      expect(chunk.content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
    expect(
      chunks
        .filter((c) => c.pageNumber === 9)
        .map((c) => c.content)
        .join(''),
    ).toBe(segments[1]!.text);
    expectFaithful(chunks, segments);
  });

  it('is deterministic', () => {
    const segments = [{ text: prose(50), locator: { page: 1 } }];

    expect(chunkSegments(segments, options, counter)).toEqual(
      chunkSegments(segments, options, counter),
    );
  });

  it('rejects overlap not smaller than the chunk size', () => {
    expect(() =>
      chunkSegments([], { sizeTokens: 10, overlapTokens: 10 }, counter),
    ).toThrow();
  });
});
