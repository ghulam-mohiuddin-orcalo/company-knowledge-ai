# Company Knowledge AI

Multi-tenant, retrieval-augmented knowledge assistant (MVP).

## Documentation

- [BA Requirements](docs/requirements/BA_REQUIREMENTS.md)
- [Technical Design](docs/architecture/TECHNICAL_DESIGN.md)
- [Implementation Backlog](docs/implementation/IMPLEMENTATION_BACKLOG.md)

## Repository layout

```
apps/
  web/              # Next.js (App Router) frontend
  api/              # NestJS HTTP API
  worker/           # NestJS application context for background ingestion
packages/
  contracts/        # shared API contract types
  config/           # shared configuration primitives
  database/         # backend-only Drizzle schema + SQL migrations
  storage/          # backend-only private object storage (S3-compatible)
  ai/               # backend-only AI provider adapters (embeddings, generation)
  ingestion/        # backend-only extraction, normalization, chunking
  eslint-config/    # shared ESLint flat configs
  tsconfig/         # shared TypeScript configs
docs/               # requirements, design and backlog
```

`apps/web` is a replaceable UI client only; all application APIs and business logic live in the NestJS API (`apps/api`), reached through explicit contracts.

## Prerequisites

- Node.js 22+
- pnpm 12 (`corepack enable` or see `packageManager` in `package.json`)

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm infra:up     # starts PostgreSQL/pgvector + object storage, creates the bucket
pnpm db:migrate   # applies database migrations
pnpm dev          # runs web (:3000), api (:3001) and worker in parallel
```

## Local infrastructure

Docker Compose (`infra/docker/compose.yaml`) runs the local dependencies only; the apps run on the host.

| Service          | Image                                 | Host address     |
| ---------------- | ------------------------------------- | ---------------- |
| `postgres`       | `pgvector/pgvector:0.8.7-pg17-trixie` | `127.0.0.1:5432` |
| `object-storage` | `chrislusf/seaweedfs:4.48` (S3 API)   | `127.0.0.1:8333` |
| `storage-init`   | `amazon/aws-cli:2.37.9` (one-shot)    | —                |

| Command            | Description                                                                |
| ------------------ | -------------------------------------------------------------------------- |
| `pnpm infra:up`    | Start dependencies, wait until healthy, create the bucket (safe to re-run) |
| `pnpm infra:check` | Verify pgvector is accepted, bucket bootstrap is repeatable and private    |
| `pnpm infra:down`  | Stop dependencies (data volumes are kept)                                  |

Defaults are local-development values only. To override them, copy `infra/docker/.env.example` to `infra/docker/.env`. To delete all local data: `docker compose -f infra/docker/compose.yaml down -v`.

The pgvector extension is available but not enabled by this stack; enabling it is part of the database migration baseline.

## Configuration

The API and worker validate their environment at startup through `packages/config` and exit with a list of missing or invalid variable names (values and secrets are never printed). For local development they read the repository-root `.env`; real environment variables take precedence. See `.env.example` for all supported variables. `apps/web` must not import backend configuration.

## Authentication and tenancy

- The API verifies OIDC JWT access tokens (`AUTH_ISSUER_URL`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`) and maps the token subject to an internal user on first sign-in. Provider roles/claims are never used for authorization.
- Roles come from the database: `MEMBER` / `ORG_ADMIN` per organization membership; `PLATFORM_ADMIN` is a user flag set only by operators.
- The active organization is resolved from the caller's memberships. Multi-organization users select one with the `X-Organization-Id` header, which is honoured only for their own active memberships.
- Errors use the envelope `{ "error": { "code", "message" } }`.

## Documents and ingestion

- `POST /v1/documents` (ORG_ADMIN): multipart upload (`file`) of PDF, DOCX or TXT up to `UPLOAD_MAX_BYTES`. The extension, declared type and file signature must agree. The original is stored privately under `org/{organizationId}/documents/{documentId}/original`; the filename is display metadata only. A queued ingestion job is created with the document.
- `GET /v1/documents` (cursor-paginated) and `GET /v1/documents/:id` (MEMBER): tenant-scoped metadata and status. Storage keys are never returned.
- `DELETE /v1/documents/:id` (ORG_ADMIN): the document becomes non-retrievable immediately (`DELETING`); the worker removes chunks and the stored original, then marks it `DELETED`. Repeating the call is safe.
- The worker (`apps/worker`) polls PostgreSQL for jobs (no broker): storage read → extraction (PDF pages, DOCX sections, TXT) → normalization → token-aware chunking → embeddings → chunks with `vector(1536)` written in the same transaction as `READY`. Retries are bounded with backoff; crashed jobs are reclaimed after a lease; failures leave `FAILED` with a safe error code.
- Embeddings use an OpenAI-compatible API (`AI_PROVIDER=openai-compatible`, `text-embedding-3-small`). Tests use a deterministic offline provider.

## Conversations and grounded answers (RAG)

- `POST /v1/conversations`, `GET /v1/conversations` and `GET /v1/conversations/:id/messages` (MEMBER): own conversations only.
- `POST /v1/conversations/:id/messages` (MEMBER, owner): body `{ "content": "question" }`. The optional `Idempotency-Key` header makes retries safe. The response is `{ question, answer }`; `answer.outcome` is `ANSWERED` (the grounded answer cites `[SOURCE_n]`) or `NO_ANSWER` (_"The answer is not available in the current knowledge base."_).
- Flow: tenant-scoped pgvector retrieval over READY documents → evidence policy (`EVIDENCE_*` thresholds) → if insufficient, the no-answer with no LLM call → otherwise a prompt with trusted rules and the evidence as delimited untrusted data → answer validation. An answer must cite provided sources; uncited replies and replies that leak the instructions become the no-answer.
- Generation uses an OpenAI-compatible Chat Completions API (`AI_GENERATION_MODEL`). Provider failures return `503 AI_PROVIDER_UNAVAILABLE`, and retrying with the same `Idempotency-Key` completes the exchange.
- `pnpm eval` runs the retrieval and RAG regression evaluation; see [docs/rag-evaluation](docs/rag-evaluation/README.md).

## Health checks

- `GET /health` (API): liveness only; never depends on the database or AI providers.
- `GET /ready` (API): `200` when PostgreSQL answers within 2 s, otherwise `503`. Error details are logged, never returned.
- The worker checks PostgreSQL at startup, logs the result, and exits non-zero if it is unreachable.

## Database

The schema is defined with Drizzle in `packages/database/src/schema.ts`; versioned SQL migrations live in `packages/database/migrations` and are committed.

- Change the schema, then `pnpm db:generate` and review the generated SQL.
- Apply migrations with `pnpm db:migrate` (needs only `DATABASE_URL`). Run it explicitly locally, in CI and as a deployment step; applications never migrate or sync the schema on startup, and `drizzle-kit push` is not used.
- `pnpm test:integration` migrates a fresh temporary database from zero (requires `pnpm infra:up`).

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

- **quality**: frozen-lockfile install, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- **database**: starts the local stack from `infra/docker/compose.yaml`, runs `pnpm db:migrate` against the empty database, then `pnpm test:integration`, the security suite (`pnpm test:security`) and the offline RAG evaluation gate (`pnpm eval`).

Any failing step fails the pull request check. Make both jobs required status checks in branch protection.

## Workspace scripts

| Command             | Description                         |
| ------------------- | ----------------------------------- |
| `pnpm dev`          | Run all apps in watch/dev mode      |
| `pnpm build`        | Build all packages and apps         |
| `pnpm lint`         | Lint all packages and apps          |
| `pnpm typecheck`    | Type-check all packages and apps    |
| `pnpm test`         | Run tests                           |
| `pnpm format`       | Format the repository with Prettier |
| `pnpm format:check` | Check formatting without writing    |

Run a single app with a filter, e.g. `pnpm --filter @cka/api dev`.
