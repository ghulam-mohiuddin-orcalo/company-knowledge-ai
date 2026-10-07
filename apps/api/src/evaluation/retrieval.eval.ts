import { performance } from 'node:perf_hooks';
import type { AppConfig } from '@cka/config';
import { APP_CONFIG } from '../config/config.module.js';
import {
  EVIDENCE_POLICY,
  type EvidencePolicy,
} from '../retrieval/evidence-policy.js';
import type { RetrievalHit } from '../retrieval/retrieval-hit.js';
import {
  type ChunkMatch,
  RetrievalRepository,
} from '../retrieval/retrieval.repository.js';
import {
  normalizeQuery,
  RetrievalService,
} from '../retrieval/retrieval.service.js';
import { type EvaluationQuestion, hitMatches } from './corpus.js';
import {
  type EvaluationHarness,
  percentile,
  readBaseline,
  round,
  startEvaluationHarness,
  writeBaseline,
  writeReport,
} from './harness.js';

/** Metrics gated against the committed baseline (latency is informational). */
export interface RetrievalBaseline {
  embeddingModel: string;
  candidates: number;
  answerable: number;
  unanswerable: number;
  hitRateCandidates: number;
  hitRateEvidence: number;
  meanReciprocalRank: number;
  /** Evidence policy (E4-T05): answerable questions judged sufficient. */
  answerableSufficientRate: number;
  /** Evidence policy: unanswerable questions judged insufficient (abstention). */
  unanswerableAbstentionRate: number;
  missedQuestions: string[];
}

const CANDIDATES = 10;

/**
 * Retrieval + evidence-policy evaluation (E4-T04, E4-T05) over the fixed corpus.
 * Offline by default (reproducible); EVAL_PROVIDERS=configured evaluates the
 * real configured embedding model. EVAL_UPDATE_BASELINE=1 rewrites the baseline.
 */
describe('retrieval evaluation (E4-T04/E4-T05)', () => {
  let harness: EvaluationHarness;

  beforeAll(async () => {
    harness = await startEvaluationHarness();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('meets the committed retrieval and evidence baseline', async () => {
    const retrieval = harness.moduleRef.get(RetrievalService);
    const repository = harness.moduleRef.get(RetrievalRepository);
    const policy = harness.moduleRef.get<EvidencePolicy>(EVIDENCE_POLICY);
    const rows = [];
    const latencies: number[] = [];

    for (const question of harness.questions) {
      const started = performance.now();
      const evidence = await retrieval.retrieve(
        harness.scope,
        question.question,
      );
      latencies.push(performance.now() - started);
      const decision = policy.evaluate(question.question, evidence);

      const vector = await harness.embeddings.embedQuery(
        normalizeQuery(question.question),
      );
      const matches = await repository.searchSimilarChunks(
        harness.scope,
        vector,
        CANDIDATES,
      );
      // Isolation: the identical corpus of the other tenant never appears.
      const returned = [...evidence, ...matches].map((r) => r.documentId);
      expect(
        returned.filter((id) => harness.foreignDocumentIds.has(id)),
      ).toEqual([]);

      rows.push({
        ...scoreQuestion(question, evidence, matches, harness),
        sufficient: decision.sufficient,
        reason: decision.reason,
      });
    }

    const answerable = rows.filter((r) => r.answerable);
    const unanswerable = rows.filter((r) => !r.answerable);
    const rate = (n: number, d: number) => round(d === 0 ? 0 : n / d);
    const current: RetrievalBaseline = {
      embeddingModel: harness.embeddings.model,
      candidates: CANDIDATES,
      answerable: answerable.length,
      unanswerable: unanswerable.length,
      hitRateCandidates: rate(
        answerable.filter((r) => r.rank !== null).length,
        answerable.length,
      ),
      hitRateEvidence: rate(
        answerable.filter((r) => r.evidenceHit).length,
        answerable.length,
      ),
      meanReciprocalRank: rate(
        answerable.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0),
        answerable.length,
      ),
      answerableSufficientRate: rate(
        answerable.filter((r) => r.sufficient).length,
        answerable.length,
      ),
      unanswerableAbstentionRate: rate(
        unanswerable.filter((r) => !r.sufficient).length,
        unanswerable.length,
      ),
      missedQuestions: answerable
        .filter((r) => !r.evidenceHit)
        .map((r) => r.id),
    };
    const report = {
      ...current,
      providerKind: harness.providerKind,
      evidenceThresholds: harness.moduleRef.get<AppConfig>(APP_CONFIG).evidence,
      latencyMs: {
        p50: round(percentile(latencies, 50), 1),
        p95: round(percentile(latencies, 95), 1),
        max: round(Math.max(...latencies), 1),
      },
      topScores: {
        answerableMin: round(Math.min(...answerable.map((r) => r.topScore))),
        answerableMedian: round(
          percentile(
            answerable.map((r) => r.topScore),
            50,
          ),
        ),
        unanswerableMax: round(
          Math.max(...unanswerable.map((r) => r.topScore)),
        ),
        unanswerableMedian: round(
          percentile(
            unanswerable.map((r) => r.topScore),
            50,
          ),
        ),
      },
      falseAbstentions: answerable
        .filter((r) => !r.sufficient)
        .map((r) => r.id),
      unsupportedSufficient: unanswerable
        .filter((r) => r.sufficient)
        .map((r) => r.id),
      questions: rows,
    };
    const path = writeReport(
      `retrieval.${current.embeddingModel}.json`,
      report,
    );
    console.log(
      `Retrieval evaluation (${current.embeddingModel}): hit@${CANDIDATES}=${current.hitRateCandidates} ` +
        `evidence=${current.hitRateEvidence} MRR=${current.meanReciprocalRank} ` +
        `sufficient(answerable)=${current.answerableSufficientRate} ` +
        `abstained(unanswerable)=${current.unanswerableAbstentionRate} ` +
        `p50=${report.latencyMs.p50}ms p95=${report.latencyMs.p95}ms -> ${path}`,
    );

    const baselineName = `retrieval.${current.embeddingModel}.json`;
    if (process.env.EVAL_UPDATE_BASELINE === '1')
      writeBaseline(baselineName, current);
    const baseline = readBaseline<RetrievalBaseline>(baselineName);
    if (!baseline) {
      // A first run with a new real model only reports; commit its baseline to gate it.
      expect(harness.providerKind).toBe('configured');
      return;
    }
    for (const metric of [
      'hitRateCandidates',
      'hitRateEvidence',
      'meanReciprocalRank',
      'answerableSufficientRate',
      'unanswerableAbstentionRate',
    ] as const) {
      expect(current[metric], metric).toBeGreaterThanOrEqual(baseline[metric]);
    }
  });
});

type Located = Pick<RetrievalHit, 'documentId'> & {
  locator: Pick<RetrievalHit['locator'], 'page' | 'section'>;
};

function scoreQuestion(
  question: EvaluationQuestion,
  evidence: RetrievalHit[],
  matches: ChunkMatch[],
  harness: EvaluationHarness,
) {
  const topScore = round(evidence[0]?.score ?? 0);
  if (!question.answerable) {
    return {
      id: question.id,
      answerable: false,
      topScore,
      rank: null,
      evidenceHit: false,
    };
  }
  const isExpected = (hit: Located) =>
    question.expected.some((source) =>
      hitMatches(hit as RetrievalHit, source, harness.documentIds),
    );
  const index = matches.findIndex((m) =>
    isExpected({
      documentId: m.documentId,
      locator: { page: m.pageNumber, section: m.sectionPath },
    }),
  );
  return {
    id: question.id,
    answerable: true,
    topScore,
    rank: index === -1 ? null : index + 1,
    evidenceHit: evidence.some(isExpected),
  };
}
