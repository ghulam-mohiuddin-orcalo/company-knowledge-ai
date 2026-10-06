import { chunkCorpusDocument, loadCorpus } from './corpus.js';

const CHUNKING = { sizeTokens: 800, overlapTokens: 120 };

describe('RAG evaluation corpus (E4-T03)', () => {
  const { documents, questions } = loadCorpus();

  it('has 5-10 documents in every supported format and 30-50 questions', () => {
    expect(documents.length).toBeGreaterThanOrEqual(5);
    expect(documents.length).toBeLessThanOrEqual(10);
    expect(new Set(documents.map((d) => d.format))).toEqual(
      new Set(['txt', 'pdf', 'docx']),
    );
    expect(questions.length).toBeGreaterThanOrEqual(30);
    expect(questions.length).toBeLessThanOrEqual(50);
  });

  it('labels answerable and unanswerable questions', () => {
    const answerable = questions.filter((q) => q.answerable);
    const unanswerable = questions.filter((q) => !q.answerable);

    expect(answerable.length).toBeGreaterThanOrEqual(20);
    expect(unanswerable.length).toBeGreaterThanOrEqual(8);
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    for (const question of unanswerable) {
      expect(question).not.toHaveProperty('expected');
    }
  });

  it('points every expected source at a real document page or section', async () => {
    const locators = new Map<string, Set<string>>();
    for (const document of documents) {
      const chunks = await chunkCorpusDocument(document, CHUNKING);
      expect(chunks.length).toBeGreaterThan(0);
      locators.set(
        document.id,
        new Set(
          chunks.map((c) => `${c.pageNumber ?? ''}|${c.sectionPath ?? ''}`),
        ),
      );
    }

    for (const question of questions) {
      if (!question.answerable) continue;
      expect(question.expected.length).toBeGreaterThan(0);
      for (const source of question.expected) {
        const available = locators.get(source.document);
        expect(available, `${question.id}: unknown document`).toBeDefined();
        const matching = [...available!].filter((locator) => {
          const [page, section] = locator.split('|');
          return (
            (source.page === undefined || page === String(source.page)) &&
            (source.section === undefined || section === source.section)
          );
        });
        expect(
          matching.length,
          `${question.id}: locator not in document`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
