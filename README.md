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
  observability/    # backend-only structured logging, correlation, metrics
  eslint-config/    # shared ESLint flat configs
  tsconfig/         # shared TypeScript configs
tests/
  e2e/              # Playwright browser end-to-end and security suite
docs/               # requirements, design and backlog
```

`apps/web` is a replaceable UI client only; all application APIs and business logic live in the NestJS API (`apps/api`), reached through explicit contracts.

## Prerequisites

- Node.js 22+
- pnpm 12 (`corepack enable` or see `packageManager` in `package.json`)

## Getting started

```bash
pnpm install
cp .env.example .env                          # set AI_API_KEY for real embeddings/answers
cp apps/web/.env.example apps/web/.env.local
pnpm infra:up      # starts PostgreSQL/pgvector + object storage, creates the bucket
pnpm infra:auth    # starts the local mock OIDC provider (development only)
pnpm db:migrate    # applies database migrations
pnpm db:seed:demo  # optional: "Demo Organization" with demo-admin and demo-member
pnpm dev           # runs web (:3000), api (:3001) and worker in parallel
```

Open http://localhost:3000 and sign in. The mock provider accepts any username: use `demo-admin` or `demo-member`, and in the claims field enter `{"email":"demo-admin@example.test","name":"Demo Admin","aud":"company-knowledge-api"}` (the `aud` must match `AUTH_AUDIENCE`). There is no self-service onboarding in the MVP: a user without a membership sees an explanatory page.

## Local infrastructure

Docker Compose (`infra/docker/compose.yaml`) runs the local dependencies only; the apps run on the host.

| Service                 | Image                                                                | Host address     |
| ----------------------- | -------------------------------------------------------------------- | ---------------- |
| `postgres`              | `pgvector/pgvector:0.8.7-pg17-trixie`                                | `127.0.0.1:5432` |
| `object-storage`        | `chrislusf/seaweedfs:4.48` (S3 API)                                  | `127.0.0.1:8333` |
| `storage-init`          | `amazon/aws-cli:2.37.9` (one-shot)                                   | —                |
| `oidc` (profile `auth`) | `ghcr.io/navikt/mock-oauth2-server:6.0.4` (mock OIDC, dev/test only) | `127.0.0.1:8080` |

| Command            | Description                                                                |
| ------------------ | -------------------------------------------------------------------------- |
| `pnpm infra:up`    | Start dependencies, wait until healthy, create the bucket (safe to re-run) |
| `pnpm infra:auth`  | Start the mock OIDC provider (issuer `http://localhost:8080/default`)      |
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
- Errors use the envelope `{ "error": { "code", "message", "requestId" } }`.

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
- Citations are server-backed: the model may only cite the `SOURCE_n` labels of the evidence it was given. The API maps those labels to the retrieved chunks, drops unknown labels, and stores citation rows copied from the tenant's own READY chunks, in the same transaction as the answer. Model-written IDs never become citations.
- `GET /v1/citations/:id/source` returns the cited passage and document metadata. `GET /v1/citations/:id/source/original` downloads the original from private storage. Both are available only to the conversation owner and re-check tenant scope on every call. Citations of deleted documents return `410 SOURCE_UNAVAILABLE`.
- Generation uses an OpenAI-compatible Chat Completions API (`AI_GENERATION_MODEL`). Provider failures return `503 AI_PROVIDER_UNAVAILABLE`, and retrying with the same `Idempotency-Key` completes the exchange.
- `pnpm eval` runs the retrieval and RAG regression evaluation; see [docs/rag-evaluation](docs/rag-evaluation/README.md).

## Web app

`apps/web` is a client-only Next.js UI over the API (no API routes, route handlers or server actions). It signs in with OIDC Authorization Code + PKCE (`oidc-client-ts`; tokens in session storage), sends the access token and the selected organization (`X-Organization-Id`) to the API, and shows only what the user's role allows; the API still enforces every rule.

- `/app`: dashboard (document readiness, recent conversations); `/app/chat`: conversations, grounded answers, citation drawer with the cited passage and original download, explicit no-answer state; `/app/documents` (admins upload/delete, everyone sees processing status and failure reasons); `/app/organization` (admins: members); `/app/platform` (platform admins).
- Configuration is public build-time only (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_OIDC_*`; see `apps/web/.env.example`). The API must allow the web origin (`APP_PUBLIC_URL` or `CORS_ALLOWED_ORIGINS`).
- Security headers: a restrictive Content-Security-Policy (`connect-src` limited to the API and identity provider, no framing, no plugins), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`. Untrusted text (file names, document passages, answers) is always rendered as text, never as HTML.

## Security and abuse controls

- Rate limits per API instance (fixed window, `RATE_LIMIT_*`): requests per client IP (health probes exempt), failed authentications per IP (checked before any token is verified), and per-user limits on questions and uploads. Exceeding a limit returns `429 RATE_LIMITED` with `Retry-After`. Set `TRUST_PROXY=true` only behind a trusted reverse proxy.
- Size limits: JSON bodies 64 KB (`413 PAYLOAD_TOO_LARGE`), uploads `UPLOAD_MAX_BYTES` (`413 DOCUMENT_TOO_LARGE`), questions `QUESTION_MAX_CHARS`, model output `AI_MAX_OUTPUT_TOKENS`; provider calls time out after `AI_REQUEST_TIMEOUT_MS`.
- API responses are never rendered, framed, sniffed or cached (`nosniff`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store`); originals download as attachments.
- `pnpm test:security` is the security regression gate: cross-tenant IDOR, a role × route access matrix, token tampering and claim escalation, citation tampering, prompt injection, invalid and malicious uploads, safe rendering headers and abuse controls. The browser suite (`pnpm test:e2e`) adds XSS rendering and CSP checks.

## Observability

- **Logs**: the API and worker write one JSON object per line (`LOG_LEVEL`) with correlation fields: `requestId` (accepted from a well-formed `X-Request-Id` header or generated, echoed in the response and error envelope), `jobId`, `organizationId`, `userId`, `documentId`. Every request produces an `http_request` access log (method, path without query, status, duration). Messages are redacted (bearer tokens, JWTs, API keys, credentials in URLs, `password=`-style values); document text, questions and answers are never logged.
- **Audit events** (`audit_events` table, tenant-scoped, no content or secrets): user provisioning, document upload and delete, ingestion success and final failure, and platform-wide listings, each with actor, target, request ID and safe metadata.
- **Metrics**: `GET /metrics` (Prometheus text format) is disabled unless `METRICS_TOKEN` is set and then requires `Authorization: Bearer <METRICS_TOKEN>`. It reports HTTP traffic by route template, retrieval and generation latency, answers by outcome and no-answer reason, AI provider errors and token usage, plus platform-wide values from the database: documents and ingestion jobs by status, queue age, ingestion latency and failures by error code, no-answer rate and answer latency over 24 hours. Metrics never carry tenant, user or document identifiers or any text.

## Failure handling and recovery

- Database outage: the API answers `503 SERVICE_UNAVAILABLE` with `Retry-After` (no internal details); `/health` stays `200` and `/ready` returns `503`; connections recover automatically. Failed uploads remove their stored original.
- AI provider failure or timeout: questions return `503 AI_PROVIDER_UNAVAILABLE` and the same `Idempotency-Key` completes the exchange exactly once; ingestion retries transient failures with backoff and fails permanently with a safe code.
- Worker: jobs are claimed with leases that are renewed while a job runs, so long jobs are never processed twice; a crashed worker's job is reclaimed after the lease expires; a worker that loses its claim abandons the job before calling the provider; only the current claim holder can commit. The polling loop backs off exponentially (up to 30 s) while the database is unavailable and resumes afterwards.
- Deletion during ingestion discards the result; chunks become searchable only together with `READY`. Integration tests check these invariants after random provider failures, worker crashes and deletions.
- `drizzle-orm` is patched (`patches/`, via `pnpm patch`) so a transaction whose `BEGIN` fails still releases its connection; without it every database outage leaked pool connections.

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
- **database**: starts the local stack from `infra/docker/compose.yaml`, runs `pnpm db:migrate` against the empty database, then `pnpm test:integration`, the security regression suite (`pnpm test:security`) and the offline RAG evaluation gate (`pnpm eval`).
- **e2e**: starts the local stack with the mock OIDC provider and runs the Playwright suite in Chromium (`pnpm test:e2e`) against the built web app, API and worker with a deterministic stand-in AI server (no paid APIs).

Any failing step fails the pull request check. Make all three jobs required status checks in branch protection.

## Workspace scripts

| Command                 | Description                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`              | Run all apps in watch/dev mode                                                                                                           |
| `pnpm build`            | Build all packages and apps                                                                                                              |
| `pnpm lint`             | Lint all packages and apps                                                                                                               |
| `pnpm typecheck`        | Type-check all packages and apps                                                                                                         |
| `pnpm test`             | Run unit tests                                                                                                                           |
| `pnpm test:integration` | Integration tests (needs `pnpm infra:up`)                                                                                                |
| `pnpm test:security`    | Security regression gate (needs `pnpm infra:up`)                                                                                         |
| `pnpm test:e2e`         | Browser end-to-end suite (needs `pnpm infra:up && pnpm infra:auth`; first run `pnpm --filter @cka/e2e exec playwright install chromium`) |
| `pnpm eval`             | Offline retrieval/RAG evaluation gate                                                                                                    |
| `pnpm db:seed:demo`     | Local demo organization and users                                                                                                        |
| `pnpm format`           | Format the repository with Prettier                                                                                                      |
| `pnpm format:check`     | Check formatting without writing                                                                                                         |

Run a single app with a filter, e.g. `pnpm --filter @cka/api dev`.
