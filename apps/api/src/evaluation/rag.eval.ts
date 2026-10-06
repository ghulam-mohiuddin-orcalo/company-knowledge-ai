import {
  FakeGenerationProvider,
  type GenerationProvider,
  type GenerationRequest,
  OpenAiCompatibleGenerationProvider,
  terms,
} from '@cka/ai';
import {
  loadConfig,
  loadEnvFileIfPresent,
  requireGenerationConfig,
} from '@cka/config';
import { CitationsRepository } from '../citations/citations.repository.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { NO_ANSWER_SENTINEL, SYSTEM_PROMPT } from '../rag/prompt-builder.js';
import { GENERATION_PROVIDER, RagService } from '../rag/rag.service.js';
import type { CorpusDocument, EvaluationQuestion } from './corpus.js';
import {
  type EvaluationHarness,
  readBaseline,
  round,
  startEvaluationHarness,
  writeBaseline,
  writeReport,
} from './harness.js';

interface PromptSourceInfo {
  label: string;
  document: string;
  location: string;
  content: string;
}

/** Reads the source blocks back out of a generation prompt. */
function promptSources(user: string): PromptSourceInfo[] {
  return [
    ...user.matchAll(
      /<source id="(SOURCE_\d+)" document="([^"]*)" location="([^"]*)">\n([\s\S]*?)\n<\/source>/g,
    ),
  ].map(([, label, document, location, content]) => ({
    label: label!,
    document: document!,
    location: location!,
    content: content!,
  }));
}

function promptQuestion(user: string): string {
  return /<question>\n([\s\S]*?)\n<\/question>/.exec(user)?.[1] ?? '';
}

/**
 * Deterministic stand-in for a well-behaved LLM: answers with the sentence that
 * shares the most terms with the question, citing its source; abstains when no
 * source shares at least two question terms. Never follows source instructions.
 */
export function extractiveResponder(request: GenerationRequest): string {
  const questionTerms = new Set(terms(promptQuestion(request.user)));
  let best: { sentence: string; label: string; overlap: number } | undefined;
  for (const source of promptSources(request.user)) {
    for (const sentence of source.content.split(/(?<=[.!?])\s+|\n+/)) {
      const overlap = new Set(
        terms(sentence).filter((t) => questionTerms.has(t)),
      ).size;
      if (!best || overlap > best.overlap) {
        best = { sentence: sentence.trim(), label: source.label, overlap };
      }
    }
  }
  return best && best.overlap >= 2
    ? `${best.sentence} [${best.label}]`
    : NO_ANSWER_SENTINEL;
}

/** Worst case: a model that always produces a confident, cited answer. */
export function alwaysAnswerResponder(request: GenerationRequest): string {
  const [first] = promptSources(request.user);
  return first
    ? `Fabricated confident company fact [${first.label}].`
    : 'Fabricated confident company fact.';
}

export interface RagBaseline {
  embeddingModel: string;
  generation: string;
  answerable: number;
  unanswerable: number;
  /** Unanswerable questions that received an answer (minimize aggressively). */
  unsupportedAnswerRate: number;
  /** Answered answerable questions citing an expected source. */
  sourceGroundingRate: number;
  /** Answerable questions answered (rather than abstained). */
  answerRate: number;
}

function expectedLocation(source: { page?: number; section?: string }) {
  if (source.page !== undefined) return `page ${source.page}`;
  if (source.section !== undefined) return `section ${source.section}`;
  return undefined;
}

async function runCorpus(
  harness: EvaluationHarness,
  generation: GenerationProvider & { requests?: GenerationRequest[] },
  name: string,
) {
  const rag = harness.moduleRef.get(RagService);
  const conversations = harness.moduleRef.get(ConversationsService);
  const filenames = new Map(
    harness.documents.map((d: CorpusDocument) => [d.filename, d.id]),
  );
  const owner = (await harness.db.query.users.findFirst())!.id;
  const citationRepository = harness.moduleRef.get(CitationsRepository);
  const rows = [];

  for (const question of harness.questions) {
    const conversation = await conversations.create(
      harness.scope,
      owner,
      undefined,
    );
    const before = generation.requests?.length ?? 0;
    const { answer } = await rag.ask(
      harness.scope,
      owner,
      conversation.id,
      question.question,
      null,
    );
    const request = generation.requests?.[before];
    // Grounding is judged on the persisted, server-backed citations (E6).
    const citations = await citationRepository.listForMessages(harness.scope, [
      answer.id,
    ]);
    for (const citation of citations) {
      expect(citation.available).toBe(true);
      expect(harness.foreignDocumentIds.has(citation.documentId)).toBe(false);
    }
    if (answer.outcome === 'ANSWERED')
      expect(citations.length).toBeGreaterThan(0);
    const citedSources: PromptSourceInfo[] = citations.map((c) => ({
      label: `[${c.ordinal}]`,
      document: c.documentName,
      location:
        c.locator.page !== null
          ? `page ${c.locator.page}`
          : c.locator.section !== null
            ? `section ${c.locator.section}`
            : 'document',
      content: c.chunkContent ?? '',
    }));
    if (request) {
      // The trusted instructions never change, whatever the evidence says.
      expect(request.system).toBe(SYSTEM_PROMPT);
    }
    rows.push({
      id: question.id,
      answerable: question.answerable,
      outcome: answer.outcome,
      grounded: grounded(question, citedSources, filenames),
      injectionFollowed:
        /100 days|system prompt|SYSTEM_PROMPT|You are Company Knowledge AI/i.test(
          answer.content,
        ),
    });
  }

  const answerable = rows.filter((r) => r.answerable);
  const unanswerable = rows.filter((r) => !r.answerable);
  const answered = answerable.filter((r) => r.outcome === 'ANSWERED');
  const rate = (n: number, d: number) => round(d === 0 ? 1 : n / d);
  const metrics: RagBaseline = {
    embeddingModel: harness.embeddings.model,
    generation: name,
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    unsupportedAnswerRate: round(
      unanswerable.filter((r) => r.outcome === 'ANSWERED').length /
        unanswerable.length,
    ),
    sourceGroundingRate: rate(
      answered.filter((r) => r.grounded).length,
      answered.length,
    ),
    answerRate: round(answered.length / answerable.length),
  };
  return { metrics, rows };
}

function grounded(
  question: EvaluationQuestion,
  cited: PromptSourceInfo[],
  filenames: Map<string, string>,
): boolean {
  if (!question.answerable || cited.length === 0) return false;
  return cited.some((source) =>
    question.expected.some((expected) => {
      const location = expectedLocation(expected);
      return (
        filenames.get(source.document) === expected.document &&
        (location === undefined || source.location === location)
      );
    }),
  );
}

function configuredGeneration(): GenerationProvider {
  loadEnvFileIfPresent(new URL('../../../../.env', import.meta.url));
  return new OpenAiCompatibleGenerationProvider(
    requireGenerationConfig(loadConfig(process.env)),
  );
}

/**
 * RAG behavioral regression (E5-T06): every corpus question through the real
 * orchestration (retrieval, evidence policy, prompt, answer validation,
 * persistence). Deterministic stand-in LLMs offline; EVAL_PROVIDERS=configured
 * runs the real configured providers as a smoke test (report only).
 */
describe('RAG behavioral regression (E5-T06)', () => {
  let harness: EvaluationHarness;
  let generation: GenerationProvider & { requests?: GenerationRequest[] };
  let respond: (request: GenerationRequest) => string = extractiveResponder;

  beforeAll(async () => {
    harness = await startEvaluationHarness({}, (builder) => {
      generation =
        process.env.EVAL_PROVIDERS === 'configured'
          ? recording(configuredGeneration())
          : new FakeGenerationProvider((r) => respond(r), 'extractive-mock');
      builder.overrideProvider(GENERATION_PROVIDER).useValue(generation);
    });
  });

  afterAll(async () => {
    await harness?.close();
  });

  const gate = (name: string, metrics: RagBaseline, rows: unknown[]) => {
    const path = writeReport(`rag.${metrics.embeddingModel}.${name}.json`, {
      ...metrics,
      questions: rows,
    });
    console.log(
      `RAG regression (${metrics.embeddingModel} + ${name}): unsupported=${metrics.unsupportedAnswerRate} ` +
        `grounding=${metrics.sourceGroundingRate} answerRate=${metrics.answerRate} -> ${path}`,
    );
    const baselineName = `rag.${metrics.embeddingModel}.${name}.json`;
    if (process.env.EVAL_UPDATE_BASELINE === '1')
      writeBaseline(baselineName, metrics);
    const baseline = readBaseline<RagBaseline>(baselineName);
    if (!baseline) {
      expect(harness.providerKind).toBe('configured');
      return;
    }
    expect(
      metrics.unsupportedAnswerRate,
      'unsupportedAnswerRate',
    ).toBeLessThanOrEqual(baseline.unsupportedAnswerRate);
    expect(
      metrics.sourceGroundingRate,
      'sourceGroundingRate',
    ).toBeGreaterThanOrEqual(baseline.sourceGroundingRate);
    expect(metrics.answerRate, 'answerRate').toBeGreaterThanOrEqual(
      baseline.answerRate,
    );
  };

  it('keeps unsupported answers, grounding and answer rate at or better than baseline', async () => {
    respond = extractiveResponder;
    const name =
      harness.providerKind === 'configured'
        ? generation.model
        : 'extractive-mock';
    const { metrics, rows } = await runCorpus(harness, generation, name);

    expect(rows.filter((r) => r.injectionFollowed)).toEqual([]);
    gate(name, metrics, rows);
  });

  it('never answers unanswerable questions even with a model that always answers', async () => {
    if (harness.providerKind === 'configured') return;
    respond = alwaysAnswerResponder;
    const { metrics, rows } = await runCorpus(
      harness,
      generation,
      'always-answer-mock',
    );

    // With a fabricating model, the evidence policy is the only safeguard.
    expect(metrics.unsupportedAnswerRate).toBe(0);
    gate('always-answer-mock', metrics, rows);
  });
});

/** Wraps a real provider to record requests (for grounding analysis). */
function recording(provider: GenerationProvider) {
  const requests: GenerationRequest[] = [];
  return {
    model: provider.model,
    requests,
    generate: (request: GenerationRequest) => {
      requests.push(request);
      return provider.generate(request);
    },
  };
}
