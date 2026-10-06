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

## Database

The schema is defined with Drizzle in `packages/database/src/schema.ts`; versioned SQL migrations live in `packages/database/migrations` and are committed.

- Change the schema, then `pnpm db:generate` and review the generated SQL.
- Apply migrations with `pnpm db:migrate` (needs only `DATABASE_URL`). Run it explicitly locally, in CI and as a deployment step; applications never migrate or sync the schema on startup, and `drizzle-kit push` is not used.
- `pnpm test:integration` migrates a fresh temporary database from zero (requires `pnpm infra:up`).

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

- **quality**: frozen-lockfile install, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- **database**: starts the `postgres` service from `infra/docker/compose.yaml`, runs `pnpm db:migrate` against the empty database, then `pnpm test:integration`.

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
