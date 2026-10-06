# RAG Evaluation

Fixed, version-controlled evaluation set for retrieval and grounded answering (TDD §29, backlog E4-T03, E4-T04, E4-T05, E5-T06).

## Corpus (E4-T03)

- `corpus.json`: 8 documents of the fictional company Northwind Analytics Ltd in every supported format (DOCX with heading sections, PDF with pages, TXT). PDF and DOCX files are generated deterministically from these definitions and go through the production extraction and chunking (`@cka/ingestion`). `Supplier Contact Notes.txt` deliberately contains a prompt-injection.
- `questions.json`: 45 labelled questions. 33 are answerable, each with its expected source (document plus page or section). 12 are unanswerable: out-of-scope or near-miss questions with no supporting source.
- The corpus is validated by `apps/api/src/evaluation/corpus.spec.ts`, part of `pnpm test`. Every expected page or section must exist after real extraction.

## Running

Requires PostgreSQL (`pnpm infra:up`) and `DATABASE_URL`.

```bash
pnpm eval                                # offline, reproducible, gated against baseline/
EVAL_UPDATE_BASELINE=1 pnpm eval         # rewrite the baseline after an intended change
EVAL_PROVIDERS=configured pnpm eval      # real configured providers (AI_* settings + API key in .env)
```

Each run indexes the corpus into a fresh database for one tenant, and an identical copy into a second tenant. Any cross-tenant result fails the run. Reports are written to `apps/api/eval-reports/` (gitignored); baselines are committed in `baseline/`.

- **Offline mode** (default, used in CI) uses `hashed-term-v1`, a deterministic lexical embedding that stands in for a semantic model. It also uses deterministic stand-in LLMs. The results are fully reproducible.
- **Configured mode** uses the real embedding and generation models (OpenAI-compatible). It reports only, until its own baseline is committed with `EVAL_UPDATE_BASELINE=1`. Evidence thresholds must be calibrated per embedding model from that report (`EVIDENCE_MIN_TOP_SCORE`, `EVIDENCE_MIN_HIT_SCORE`).

## Metrics

| Metric | Meaning |
|---|---|
| `hitRateCandidates` | Expected source among the top-10 retrieved chunks |
| `hitRateEvidence` | Expected source in the merged evidence passed to generation |
| `meanReciprocalRank` | Rank quality of the expected source |
| `answerableSufficientRate` | Evidence policy judged answerable questions sufficient |
| `unanswerableAbstentionRate` | Evidence policy rejected unanswerable questions |
| `unsupportedAnswerRate` | Unanswerable questions that got an answer (target 0) |
| `sourceGroundingRate` | Answered questions whose persisted citations (E6) include an expected source |
| `answerRate` | Answerable questions answered rather than abstained |
| `latencyMs` | Retrieval latency, query embedding plus vector search (informational) |

## Offline baseline (committed 2026-10-06; RAG grounding re-baselined with E6 citations)

Offline evidence thresholds: top score ≥ 0.30, hit score ≥ 0.20 (`OFFLINE_EVALUATION_ENV`).

| Run | Result |
|---|---|
| Retrieval (`hashed-term-v1`) | hit@10 1.00 · evidence hit 1.00 · MRR 0.929 · p95 about 3 ms |
| Evidence policy | 78.8% of answerable judged sufficient · 100% of unanswerable abstained |
| RAG, extractive stand-in LLM | unsupported 0.00 · grounding 1.00 · answer rate 0.727 |
| RAG, always-answer stand-in LLM | unsupported 0.00 · grounding 0.962 · answer rate 0.788 |

The always-answer stand-in fabricates an answer for any evidence it receives. It shows that the evidence policy alone keeps unanswerable questions from being answered.

The thresholds are deliberately conservative: unsupported answers are minimised first (TDD §29). The 7 false abstentions are short questions against long TXT documents. That's a known limit of the lexical stand-in, and the real-model run is expected to improve on it. No prompt-injected instruction was followed in any run.
