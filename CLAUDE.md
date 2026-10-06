# CLAUDE.md

Company Knowledge AI — multi-tenant RAG knowledge assistant. pnpm monorepo: `apps/web` (Next.js), `apps/api` (NestJS), `apps/worker` (NestJS context), `packages/*` (shared contracts, config, ESLint, tsconfig).

## Source of truth

Before implementing anything, read:

1. `docs/requirements/BA_REQUIREMENTS.md`: what to build (approved requirements)
2. `docs/architecture/TECHNICAL_DESIGN.md`: how to build it
3. `docs/implementation/IMPLEMENTATION_BACKLOG.md`: ticket scope and acceptance criteria

Precedence: BA → TDD → backlog. Do not redesign or reinterpret approved requirements. If the code needs to deviate from the TDD, say so explicitly; do not silently redesign. The original `.docx` files are the archived originals and must not be modified.

## Working rules

- Implement **only the requested ticket**. Never implement future tickets or adjacent features unless explicitly asked.
- Security and tenant isolation come first: tenant context is derived from the authenticated principal or membership, never from request input. Tenant-owned queries always carry organization scope. Never weaken a security boundary to simplify a ticket.
- Avoid unnecessary architecture or infrastructure (no extra queues, vector DBs, Kubernetes, etc. unless the docs require them).
- Inspect existing code and conventions before changing anything; match them.
- Never share ORM entities or backend internals through `packages/contracts`.
- API routes: every non-public route declares `@Authorize('AUTHENTICATED' | 'MEMBER' | 'ORG_ADMIN' | 'PLATFORM_ADMIN')`; routes without one are denied. Only health endpoints are `@Public()`.
- Tenant-owned repository methods take `scope: TenantScope` first (from `TenantScope.fromPrincipal`) and filter `organization_id` in SQL; no `findById(id)` on tenant resources (lint-enforced). Foreign IDs must behave exactly like unknown IDs.
- Every new tenant-owned aggregate gets cases in the cross-tenant security suite (`pnpm test:security`).
- Never log or print secrets or confidential document content.
- Never commit or push unless explicitly requested.

## Architecture boundary (permanent)

- `apps/web` is UI/client only. Next.js is the current MVP UI choice but must remain replaceable.
- Do not put application APIs or business logic in Next.js API Routes, Route Handlers or Server Actions.
- `apps/api` (NestJS) is the authoritative application API/backend. Business logic, auth, authorization, tenancy, documents, conversations, RAG and citations belong behind it.
- The frontend talks to NestJS only through explicit API contracts (`packages/contracts`).
- Replacing the frontend framework must not require redesigning the backend.

## Verification

Run the relevant checks before reporting completion:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration   # needs `pnpm infra:up` and DATABASE_URL
pnpm test:security      # cross-tenant gate; same requirements
pnpm build
```

Report files changed, check results, and any deviation or blocker.
