import type { RetrievalHit } from './retrieval-hit.js';

export type EvidenceReason =
  'SUFFICIENT_EVIDENCE' | 'NO_EVIDENCE' | 'WEAK_EVIDENCE';

export interface EvidenceDecision {
  sufficient: boolean;
  /** Evidence to pass to generation (empty when insufficient). */
  selectedHits: RetrievalHit[];
  reason: EvidenceReason;
}

/**
 * Decides whether retrieved evidence is strong enough to answer (TDD §15).
 * Implementations may evolve (e.g. rerankers); callers depend on this only.
 */
export interface EvidencePolicy {
  evaluate(query: string, hits: readonly RetrievalHit[]): EvidenceDecision;
}

export const EVIDENCE_POLICY = Symbol('EVIDENCE_POLICY');

/**
 * Baseline heuristic: answer only when the strongest hit reaches
 * `minTopScore`; pass on hits reaching `minHitScore`. Thresholds are
 * configuration calibrated per embedding model against the evaluation corpus.
 */
export class ScoreThresholdEvidencePolicy implements EvidencePolicy {
  constructor(
    private readonly thresholds: { minTopScore: number; minHitScore: number },
  ) {}

  evaluate(_query: string, hits: readonly RetrievalHit[]): EvidenceDecision {
    if (hits.length === 0) {
      return { sufficient: false, selectedHits: [], reason: 'NO_EVIDENCE' };
    }
    const top = Math.max(...hits.map((hit) => hit.score));
    if (!(top >= this.thresholds.minTopScore)) {
      return { sufficient: false, selectedHits: [], reason: 'WEAK_EVIDENCE' };
    }
    return {
      sufficient: true,
      selectedHits: hits
        .filter((hit) => hit.score >= this.thresholds.minHitScore)
        .sort((a, b) => b.score - a.score),
      reason: 'SUFFICIENT_EVIDENCE',
    };
  }
}
