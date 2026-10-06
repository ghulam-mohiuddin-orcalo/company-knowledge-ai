import { ScoreThresholdEvidencePolicy } from './evidence-policy.js';
import type { RetrievalHit } from './retrieval-hit.js';

const hit = (score: number, id = String(score)): RetrievalHit => ({
  chunkIds: [id],
  documentId: 'doc',
  documentName: 'Doc.txt',
  content: 'text',
  score,
  locator: { page: null, section: null, charStart: 0, charEnd: 4 },
});

describe('ScoreThresholdEvidencePolicy (E4-T05)', () => {
  const policy = new ScoreThresholdEvidencePolicy({
    minTopScore: 0.4,
    minHitScore: 0.3,
  });

  it('is insufficient without evidence', () => {
    expect(policy.evaluate('q', [])).toEqual({
      sufficient: false,
      selectedHits: [],
      reason: 'NO_EVIDENCE',
    });
  });

  it('is insufficient when even the strongest hit is weak', () => {
    expect(policy.evaluate('q', [hit(0.39), hit(0.2)])).toEqual({
      sufficient: false,
      selectedHits: [],
      reason: 'WEAK_EVIDENCE',
    });
  });

  it('selects hits above the per-hit threshold, strongest first', () => {
    const decision = policy.evaluate('q', [
      hit(0.31),
      hit(0.1),
      hit(0.4),
      hit(0.29),
    ]);

    expect(decision.sufficient).toBe(true);
    expect(decision.reason).toBe('SUFFICIENT_EVIDENCE');
    expect(decision.selectedHits.map((h) => h.score)).toEqual([0.4, 0.31]);
  });

  it('treats non-numeric scores as insufficient', () => {
    expect(policy.evaluate('q', [hit(Number.NaN)]).sufficient).toBe(false);
  });

  it('does not depend on the question text', () => {
    const hits = [hit(0.5)];

    expect(policy.evaluate('anything', hits)).toEqual(
      policy.evaluate('something else entirely', hits),
    );
  });
});
