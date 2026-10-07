import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import {
  type EmbeddingProvider,
  HashedTermEmbeddingProvider,
  OpenAiCompatibleEmbeddingProvider,
} from '@cka/ai';
import {
  loadConfig,
  loadEnvFileIfPresent,
  requireEmbeddingConfig,
} from '@cka/config';
import { type Database, EMBEDDING_DIMENSIONS } from '@cka/database';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { DATABASE } from '../database/database.module.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { EMBEDDING_PROVIDER } from '../retrieval/retrieval.service.js';
import { TenantScope } from '../tenancy/tenant-scope.js';
import { createTestConfig } from '../testing/test-config.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import { UsersService } from '../users/users.service.js';
import {
  type CorpusDocument,
  EVALUATION_DIR,
  type EvaluationQuestion,
  indexCorpus,
  loadCorpus,
} from './corpus.js';

/**
 * Offline evaluation settings (centralized). The offline lexical provider has a
 * different score distribution from production models, so it has its own
 * calibrated evidence thresholds; production defaults live in config.
 */
export const OFFLINE_EVALUATION_ENV: NodeJS.ProcessEnv = {
  EVIDENCE_MIN_TOP_SCORE: '0.30',
  EVIDENCE_MIN_HIT_SCORE: '0.20',
};

export interface EvaluationHarness {
  moduleRef: TestingModule;
  db: Database;
  scope: TenantScope;
  /** Corpus document id -> database document id (evaluated tenant). */
  documentIds: Map<string, string>;
  /** Database document ids of the identical corpus indexed for another tenant. */
  foreignDocumentIds: Set<string>;
  documents: CorpusDocument[];
  questions: EvaluationQuestion[];
  embeddings: EmbeddingProvider;
  /** 'offline' (hashed-term-v1) or 'configured' (real provider from env). */
  providerKind: 'offline' | 'configured';
  close(): Promise<void>;
}

/** Real providers only when explicitly requested (EVAL_PROVIDERS=configured). */
export function evaluationProviderKind(): 'offline' | 'configured' {
  return process.env.EVAL_PROVIDERS === 'configured' ? 'configured' : 'offline';
}

function configuredEmbeddings(): EmbeddingProvider {
  loadEnvFileIfPresent(new URL('../../../../.env', import.meta.url));
  const embedding = requireEmbeddingConfig(loadConfig(process.env));
  if (embedding.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(`AI_EMBEDDING_DIMENSIONS must be ${EMBEDDING_DIMENSIONS}`);
  }
  return new OpenAiCompatibleEmbeddingProvider(embedding);
}

/**
 * Builds an isolated database with the corpus indexed for the evaluated tenant
 * and, identically, for a second tenant (to prove isolation during evaluation).
 */
export async function startEvaluationHarness(
  env: NodeJS.ProcessEnv = {},
  overrides: (
    builder: ReturnType<typeof Test.createTestingModule>,
  ) => void = () => undefined,
): Promise<EvaluationHarness> {
  const providerKind = evaluationProviderKind();
  const embeddings =
    providerKind === 'configured'
      ? configuredEmbeddings()
      : new HashedTermEmbeddingProvider(EMBEDDING_DIMENSIONS);
  const testDb: TestDatabase = await createTestDatabase();
  const builder = Test.createTestingModule({
    imports: [
      AppModule.forRoot(
        createTestConfig({
          DATABASE_URL: testDb.url,
          ...(providerKind === 'offline' ? OFFLINE_EVALUATION_ENV : {}),
          ...env,
        }),
      ),
    ],
  });
  builder.overrideProvider(EMBEDDING_PROVIDER).useValue(embeddings);
  overrides(builder);
  const moduleRef = await builder.compile();
  const db = moduleRef.get<Database>(DATABASE);
  const config = moduleRef.get(OrganizationsService);
  const { userId } = await moduleRef.get(UsersService).resolveVerifiedIdentity({
    subject: 'evaluation-uploader',
    email: 'eval@example.test',
    displayName: 'Evaluation',
  });
  const evaluated = await config.createOrganization(
    'Northwind Analytics (evaluation)',
  );
  const other = await config.createOrganization(
    'Other tenant (isolation check)',
  );
  const { documents, questions } = loadCorpus();
  const chunking = { sizeTokens: 800, overlapTokens: 120 };
  const documentIds = await indexCorpus(
    db,
    { organizationId: evaluated.id, uploadedBy: userId },
    documents,
    embeddings,
    chunking,
  );
  const foreign = await indexCorpus(
    db,
    { organizationId: other.id, uploadedBy: userId },
    documents,
    embeddings,
    chunking,
  );

  return {
    moduleRef,
    db,
    scope: TenantScope.forSystem(evaluated.id),
    documentIds,
    foreignDocumentIds: new Set(foreign.values()),
    documents,
    questions,
    embeddings,
    providerKind,
    close: async () => {
      await moduleRef.close();
      await testDb.drop();
    },
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ]!;
}

export const round = (value: number, digits = 4) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

const REPORT_DIR = new URL('../../eval-reports/', import.meta.url);

/** Writes the latest report (gitignored) next to the app. */
export function writeReport(name: string, report: unknown): string {
  mkdirSync(REPORT_DIR, { recursive: true });
  const url = new URL(name, REPORT_DIR);
  writeFileSync(url, `${JSON.stringify(report, null, 2)}\n`);
  return url.pathname;
}

const BASELINE_DIR = new URL('baseline/', EVALUATION_DIR);

/** The committed baseline for a provider/model, if any. */
export function readBaseline<T>(name: string): T | undefined {
  const url = new URL(name, BASELINE_DIR);
  return existsSync(url)
    ? (JSON.parse(readFileSync(url, 'utf8')) as T)
    : undefined;
}

/** Rewrites the committed baseline (only with EVAL_UPDATE_BASELINE=1). */
export function writeBaseline(name: string, baseline: unknown): void {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(
    new URL(name, BASELINE_DIR),
    `${JSON.stringify(baseline, null, 2)}\n`,
  );
}
