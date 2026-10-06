# COMPANY KNOWLEDGE AI

**MVP Implementation Backlog & Delivery Plan**

Derived from BA Requirements v1.0 + TDD v1.0  
06 October 2026

| Planning Item | Baseline |
|---|---|
| Delivery model | Dependency-ordered epics and developer-ready tickets |
| Architecture | Next.js + NestJS modular monolith + worker + PostgreSQL/pgvector + S3-compatible storage |
| Priority convention | P0 = required MVP gate; P1 = valuable MVP hardening |
| Estimation | Relative complexity: S / M / L; not calendar commitments |
| Security gates | Tenant isolation and authorization must pass before RAG feature completion |
| Quality gate | Each ticket includes acceptance and verification requirements |

## 1. Delivery Rules

- Implement in dependency order unless a ticket explicitly permits parallel work.
- Do not weaken BA/TDD security boundaries to simplify a ticket.
- Every schema change is migration-backed; no manual production schema edits.
- Every tenant-owned query must be reviewed for tenant scope.
- Every completed ticket includes tests appropriate to its layer.
- Do not add RabbitMQ, a separate vector database, Kubernetes, Elasticsearch or additional infrastructure unless a measured requirement triggers it.
- RAG tuning is driven by the fixed evaluation corpus, not subjective prompt iteration alone.

## 2. Epic Overview

| Epic | Name | Priority | Outcome | Depends On |
|---|---|---|---|---|
| E0 | Engineering Foundation | P0 | Repo, local infrastructure, configuration, migrations, CI. | None |
| E1 | Identity, Tenancy & RBAC | P0 | Secure principal model and tenant isolation. | E0 |
| E2 | Document Management | P0 | Private upload/storage/document lifecycle. | E1 |
| E3 | Ingestion & Vector Index | P0 | Extract, chunk, embed, index asynchronously. | E2 |
| E4 | Retrieval & Evaluation | P0 | Tenant-safe retrieval and regression corpus. | E3 |
| E5 | Conversations & RAG | P0 | Grounded chat and abstention behavior. | E4 |
| E6 | Citation Integrity | P0 | Server-backed citations and source resolution. | E5 |
| E7 | Frontend Product UX | P0 | Complete admin/member application flows. | E1-E6 |
| E8 | Security, Reliability & Observability | P0/P1 | Hardening, audit, rate limits, operational visibility. | E1-E7 |
| E9 | Deployment & Demo Readiness | P0 | Hosted repeatable MVP and runbook. | E8 |

## 3. Developer-Ready Ticket Register

| Ticket | Title | Priority | Size | Dependencies | Scope | Acceptance / Verification |
|---|---|---|---|---|---|---|
| E0-T01 | Initialize monorepo | P0 | M | None | Create apps/web, apps/api, apps/worker and shared packages; configure TypeScript, linting, formatting and workspace scripts. | Fresh clone installs dependencies; web/API/worker build and typecheck; no provider/business logic added. |
| E0-T02 | Local Docker infrastructure | P0 | M | E0-T01 | Create compose stack for pgvector-enabled PostgreSQL and S3-compatible local object storage; application services may run host-side initially. | One documented command starts dependencies; PostgreSQL accepts pgvector extension; storage bucket/bootstrap is repeatable. |
| E0-T03 | Validated configuration module | P0 | S | E0-T01 | Centralize environment parsing/validation for DB, storage, auth, AI, uploads, jobs and app URLs. | Missing required config fails startup with safe actionable error; secrets are never printed. |
| E0-T04 | Database migration baseline | P0 | M | E0-T02,E0-T03 | Select project ORM/migration approach and create initial migrations for organizations/users/memberships plus pgvector extension. | Empty DB migrates forward from zero; migration can run in CI/local; no schema auto-sync in production. |
| E0-T05 | CI quality pipeline | P0 | S | E0-T01 | Add CI for install, lint, typecheck, tests and build. | Pull request fails on lint/type/test/build errors; dependency cache optional. |
| E0-T06 | Health/readiness endpoints | P0 | S | E0-T03,E0-T04 | Add API liveness/readiness endpoints and worker startup health logging. | /health does not depend on external AI; /ready validates required serving dependencies. |
| E1-T01 | Authentication adapter and internal user mapping | P0 | M | E0 | Integrate chosen auth provider behind backend identity adapter; map verified identity to internal User. | Unauthenticated protected calls return 401; provider claims are not used directly as domain authorization. |
| E1-T02 | Organization and membership schema/services | P0 | M | E1-T01 | Implement organizations, memberships, role enum and tenant-aware service/repository methods. | User can belong to organization; duplicate membership prevented; role persisted. |
| E1-T03 | Request principal and active tenant context | P0 | M | E1-T02 | Resolve userId, organizationId, membershipId and role for each protected request. | Trusted tenant identity comes from membership/session context, never arbitrary request body organizationId. |
| E1-T04 | RBAC guards/policies | P0 | M | E1-T03 | Implement MEMBER, ORG_ADMIN and PLATFORM_ADMIN authorization policies. | Member cannot invoke admin-only API even by direct HTTP request; denied operations return 403. |
| E1-T05 | Tenant-safe repository conventions | P0 | M | E1-T03 | Define repository APIs requiring organization scope for tenant resources; prohibit generic tenant-resource findById patterns. | Code review/test examples demonstrate all tenant-owned lookups include tenant context. |
| E1-T06 | Cross-tenant security integration suite | P0 | L | E1-T04,E1-T05 | Create Org A/Org B fixtures and reusable tests for tenant boundaries. | Attempts using another tenant's IDs fail without revealing resource data; suite becomes required CI gate. |
| E2-T01 | Document/ingestion schema | P0 | M | E1 | Add documents and ingestion_jobs tables, enums/state fields, constraints and indexes. | Migrations pass; states support QUEUED/PROCESSING/READY/FAILED plus deletion lifecycle. |
| E2-T02 | Private object storage adapter | P0 | M | E0-T02,E2-T01 | Implement server-side storage interface and S3-compatible adapter with generated tenant/document object keys. | Objects are private; user filename cannot control path; adapter is testable without leaking credentials. |
| E2-T03 | Document upload API | P0 | L | E1,E2-T01,E2-T02 | Admin-only multipart upload with MIME/extension allow-list, size validation, metadata persistence and queued ingestion job creation. | Valid PDF/DOCX/TXT returns document status; unsupported/oversized files rejected; Member gets 403. |
| E2-T04 | Document list/detail APIs | P0 | M | E2-T03 | Tenant-scoped paginated document list/detail with safe metadata and processing state. | Org A never sees Org B docs; storage keys/internal errors excluded from response. |
| E2-T05 | Document deletion flow | P0 | L | E2-T04 | Admin marks document non-searchable before asynchronous cleanup; remove chunks/object safely/idempotently. | Deleted/deleting doc cannot be retrieved; repeated delete is safe; cross-tenant delete denied. |
| E2-T06 | Document admin UI baseline | P0 | M | E2-T03,E2-T04 | Build documents page, upload control, status display, errors and delete confirmation. | Admin can complete upload/list/delete flow without API tools; Member lacks mutation controls. |
| E3-T01 | Extractor interfaces + TXT extractor | P0 | M | E2 | Create extractor abstraction returning normalized text plus source metadata; implement TXT. | Worker can extract a sample TXT; empty/unusable content produces classified failure. |
| E3-T02 | PDF and DOCX extractors | P0 | L | E3-T01 | Implement machine-readable PDF/DOCX extraction with page/section metadata where available. | Representative fixtures extract expected text; encrypted/unreadable files fail safely. |
| E3-T03 | Token-aware chunker | P0 | M | E3-T01 | Implement configurable chunk size/overlap while preserving locator metadata. | Deterministic fixture tests cover boundaries, overlap and source metadata. |
| E3-T04 | Embedding provider abstraction | P0 | M | E0-T03 | Implement EmbeddingProvider interface and first configured provider adapter with batching/timeouts/error classification. | Domain ingestion code has no provider SDK types; fixture/mock adapter supports tests. |
| E3-T05 | Document chunk/vector schema | P0 | M | E0-T04,E3-T03,E3-T04 | Create document_chunks vector column matching selected embedding dimension, metadata and indexes. | Migration validates dimension; chunk uniqueness and tenant/document indexes exist. |
| E3-T06 | Database-backed worker claim/retry | P0 | L | E2-T01 | Worker polls and claims QUEUED jobs safely using locking/idempotency; bounded retries and safe failure states. | Two workers cannot process same job concurrently; crash/retry does not duplicate active chunks. |
| E3-T07 | End-to-end ingestion pipeline | P0 | L | E3-T02-E3-T06 | Connect storage read -> extraction -> normalization -> chunking -> embeddings -> vector persistence -> READY. | Sample PDF/DOCX/TXT reach READY; provider failure produces FAILED/retry state; partial index never searchable. |
| E3-T08 | Ingestion integration tests | P0 | M | E3-T07 | Test valid formats, empty content, provider failure, duplicate worker claim and delete-during-processing behavior. | Tests run in CI against real PostgreSQL/pgvector where required. |
| E4-T01 | Retrieval repository | P0 | L | E3 | Implement parameterized pgvector similarity query scoped by organization and READY documents. | Expected chunks returned for fixtures; cross-tenant chunks cannot appear even with known IDs/content. |
| E4-T02 | Retrieval service + deduplication | P0 | M | E4-T01 | Return bounded RetrievalHit objects; merge/deduplicate adjacent/overlapping evidence where useful. | Stable internal contract includes chunk/document IDs, score and locator metadata. |
| E4-T03 | RAG evaluation corpus | P0 | M | E3 | Create 5-10 representative documents and 30-50 labeled answerable/unanswerable questions with expected source locators. | Corpus is version-controlled and executable; labels identify expected source or unanswerable status. |
| E4-T04 | Retrieval evaluation runner | P0 | M | E4-T02,E4-T03 | Build script/test to calculate expected-source hit rate and capture latency. | Produces reproducible report; baseline committed/documented before tuning. |
| E4-T05 | EvidencePolicy abstraction | P0 | M | E4-T02,E4-T03 | Implement configurable sufficiency decision returning sufficient/selectedHits/reason. | Unanswerable corpus can be evaluated without hard-coding question text; thresholds/config centralized. |
| E5-T01 | Conversation/message schema and APIs | P0 | L | E1 | Implement own-conversation create/list/messages with tenant/user authorization. | Users access only authorized conversations; cross-user/cross-tenant IDOR tests pass. |
| E5-T02 | Generation provider abstraction | P0 | M | E0-T03 | Implement GenerationProvider and first LLM adapter with timeout, usage and classified errors. | RAG domain code imports provider interface only; mock provider usable in tests. |
| E5-T03 | Prompt builder | P0 | M | E4-T05,E5-T02 | Build trusted system instructions and clearly delimited untrusted evidence using stable SOURCE_n labels. | Prompt-injection fixture cannot alter tenant/auth/tool behavior; hidden prompt not exposed. |
| E5-T04 | RAG orchestration service | P0 | L | E4,E5-T01-E5-T03 | Persist user message, retrieve, evaluate evidence, generate when sufficient, persist assistant result. | Answerable flow returns grounded answer; insufficient evidence returns explicit no-answer without provider call where policy permits. |
| E5-T05 | Ask API | P0 | M | E5-T04 | Expose POST message/ask contract with validation, idempotency strategy as needed and safe error envelope. | Question length limits enforced; provider failures are safe/retryable; no raw provider error returned. |
| E5-T06 | RAG behavioral regression tests | P0 | L | E5-T05,E4-T03 | Run answerable/unanswerable corpus through retrieval/generation test harness using deterministic mocks plus selected provider smoke tests. | Unsupported-answer rate and source grounding are reviewed against agreed baseline; regressions fail release checks. |
| E6-T01 | Citation persistence model | P0 | M | E5 | Add answer_citations linked to assistant message, tenant, document and chunk. | Only server-known retrieval hits can become citation rows; constraints/indexes added. |
| E6-T02 | Citation label parser/mapping | P0 | M | E6-T01,E5-T03 | Map recognized SOURCE_n references to retrieval hits; ignore/reject unknown model labels. | Model cannot create arbitrary document/chunk IDs through output. |
| E6-T03 | Citation response contract | P0 | M | E6-T02 | Return ordinal, document display name, locator and safe excerpt with assistant message. | Every returned citation maps to persisted authorized source evidence. |
| E6-T04 | Authorized source resolution | P0 | L | E6-T03,E2 | Implement citation source endpoint/view with fresh tenant authorization and private storage access. | Tampered citation/document IDs cannot expose another tenant; source is usable from UI. |
| E6-T05 | Citation integrity tests | P0 | M | E6-T04 | Test fabricated labels, stale/deleted documents, cross-tenant IDs and valid page/section resolution. | All integrity/security cases pass in CI. |
| E7-T01 | Authenticated app shell | P0 | M | E1 | Build authenticated navigation/layout, current org/user display and role-aware navigation. | Unauthenticated users redirected appropriately; role UI matches backend capabilities. |
| E7-T02 | Chat conversation UI | P0 | L | E5 | Conversation list/thread/composer/loading/error/no-answer states. | Member can create/open conversation and ask question end-to-end. |
| E7-T03 | Citation UX | P0 | M | E6,E7-T02 | Render numbered citations and source drawer/view with document/locator/excerpt. | Citation click resolves only authorized source; invalid source handled gracefully. |
| E7-T04 | Dashboard | P1 | S | E2,E5 | Add concise knowledge readiness/recent conversation entry points. | Dashboard does not introduce new analytics backend requirements. |
| E7-T05 | Accessibility/responsive pass | P1 | M | E7-T01-E7-T04 | Keyboard/form labels/focus/error states and common desktop/mobile widths. | Core upload/chat flows usable via keyboard and without clipped controls. |
| E8-T01 | Structured logging/correlation | P0 | M | E0 | Add request IDs, job IDs and structured logs with redaction policy. | Logs support tracing API/job failures without full document/prompt content or secrets. |
| E8-T02 | Audit events | P1 | M | E1,E2 | Record document upload/delete, ingestion result and privileged actions. | Audit records are tenant scoped where applicable and contain no secrets. |
| E8-T03 | Rate limiting and abuse controls | P0 | M | E5 | Apply sensible limits to auth-sensitive, upload and ask endpoints; provider timeouts/size limits enforced. | Repeated abuse receives controlled response; normal demo workflow unaffected. |
| E8-T04 | Security regression suite | P0 | L | E1-E7 | Automate cross-tenant IDOR, role bypass, citation tampering, prompt injection, invalid upload and unsafe rendering cases. | Security suite is CI/release gate. |
| E8-T05 | Operational metrics | P1 | M | E3,E5 | Capture ingestion latency/failures, retrieval/generation latency, no-answer rate and provider usage signals. | Metrics exclude sensitive document text and can diagnose demo/pilot issues. |
| E8-T06 | Failure/recovery hardening | P0 | L | E3,E5,E6 | Verify provider timeout, worker crash, deletion race, DB failure boundaries and retry behavior. | No inconsistent READY state, orphan searchable data or duplicate job processing in tested scenarios. |
| E9-T01 | Production container builds | P0 | M | E0-E8 | Create reproducible web/API/worker production images with non-dev startup commands. | Images build in CI and start with validated production config. |
| E9-T02 | Staging deployment | P0 | L | E9-T01 | Deploy web/API/worker with managed pgvector PostgreSQL and private object storage. | HTTPS works; only intended services public; migrations and readiness succeed. |
| E9-T03 | Backup/secret/environment runbook | P0 | M | E9-T02 | Document secrets, migration procedure, DB backup expectations, rollback/recovery basics and environment separation. | Another engineer can deploy/update staging without undocumented local knowledge. |
| E9-T04 | Demo seed and script | P0 | M | E9-T02 | Prepare demo org/users/sample documents and a 2-5 minute deterministic demo path. | Demo shows upload/Ready, grounded answer/citation, unknown answer and admin/member permissions. |
| E9-T05 | MVP release checklist | P0 | M | E9-T03,E9-T04 | Run BA DoD, security suite, RAG eval, build/deploy checks and document known limitations. | All P0 tickets complete; unresolved exceptions explicitly accepted/documented. |

## 4. Critical Path

The recommended critical path is:

E0 Foundation -> E1 Tenancy/RBAC -> E2 Documents -> E3 Ingestion -> E4 Retrieval -> E5 RAG -> E6 Citations -> E7 Product UX -> E8 Hardening -> E9 Deployment.

Frontend shell work can run in parallel after E1. Provider adapter work can run in parallel once configuration interfaces are stable. Do not start final RAG tuning before the evaluation corpus exists.

## 5. Milestone Gates

| Milestone | Required Tickets / Evidence | Gate |
|---|---|---|
| M1 Secure Skeleton | E0 + E1 | Authenticated app/API exists; Org A/Org B isolation suite passes. |
| M2 Knowledge Ingestion | E2 + E3 | Admin uploads supported docs; worker reaches READY/FAILED correctly. |
| M3 Retrieval Baseline | E4 | Evaluation corpus exists; expected-source retrieval baseline recorded. |
| M4 Grounded Chat | E5 | Answerable + no-answer behavior works and is regression tested. |
| M5 Trustworthy Sources | E6 | Citations are server-backed and tamper/cross-tenant tests pass. |
| M6 Usable Product | E7 | Admin/member core flows work without API tooling. |
| M7 Release Candidate | E8 | Security/recovery gates pass; logs/limits operational. |
| M8 Hosted MVP | E9 | Staging/production-like deployment and deterministic demo verified. |

## 6. Parallelization Guidance

| After Gate | Can Run in Parallel |
|---|---|
| E0 stable | Auth adapter, DB domain migrations, web shell, provider-interface scaffolding. |
| E1 stable | Document backend + authenticated frontend shell. |
| E2 stable | Extractor work, worker claim logic, document UI refinement. |
| E3 stable | Evaluation corpus labeling + retrieval implementation. |
| E4 stable | Conversation schema + generation adapter + prompt builder. |
| E5 stable | Citation persistence + chat UI. |
| E6 stable | Citation UX + security regression expansion + deployment preparation. |

## 7. Ticket Completion Checklist

- Scope implemented without unrelated architectural additions.
- Relevant unit/integration/E2E tests added and passing.
- Tenant/authorization impact reviewed explicitly.
- Errors are safe and machine-readable where API-facing.
- Configuration is validated and documented if new config is introduced.
- Migration included for persistent schema changes.
- Logs contain correlation context but no secrets/confidential source content by default.
- Acceptance criteria demonstrated locally/CI.
- BA/TDD documentation or ADR updated if implementation required a design change.

## 8. First Implementation Batch

Start with the following batch before assigning any RAG feature work:

| Order | Ticket | Expected Output |
|---|---|---|
| 1 | E0-T01 | Monorepo skeleton and workspace scripts. |
| 2 | E0-T02 | Local PostgreSQL/pgvector + object storage. |
| 3 | E0-T03 | Validated config package/module. |
| 4 | E0-T04 | Migration baseline. |
| 5 | E0-T05 | CI quality pipeline. |
| 6 | E0-T06 | Health/readiness. |
| 7 | E1-T01 | Authentication adapter/internal user mapping. |
| 8 | E1-T02 | Organization/membership model. |
| 9 | E1-T03 | Trusted request principal. |
| 10 | E1-T04 | RBAC. |
| 11 | E1-T05 | Tenant-safe repositories. |
| 12 | E1-T06 | Cross-tenant security gate. |

Do not begin document ingestion until M1 Secure Skeleton is green. This prevents tenant isolation from being retrofitted into already-built document/vector code.

## 9. Agent Handoff Contract

When a ticket is given to Claude Code, Codex or another coding agent, provide the BA document, TDD, repository state and exactly one ticket (or a small explicitly grouped batch). The agent must inspect existing code first, implement only the ticket scope, run verification commands, report files changed and surface any deviation from TDD rather than silently redesigning the system.

- Goal: ticket title + outcome.
- Context: relevant BA/TDD sections and existing repo conventions.
- Scope: exact functionality to implement.
- Constraints: tenant/security/architecture rules.
- Non-goals: adjacent features not to implement.
- Acceptance criteria: copied from ticket plus any repo-specific checks.
- Verification: lint, typecheck, tests, migrations/build and security case where relevant.
- Output: concise change summary, commands/results, unresolved risks or decisions.

## 10. MVP Completion Rule

MVP is complete when every P0 ticket is implemented, the BA Definition of Done is satisfied, cross-tenant/security tests pass, the RAG evaluation baseline shows acceptable grounded/no-answer behavior, citations resolve to real authorized evidence, and the application is deployed through the documented production-like process. P1 tickets may be deferred unless they become necessary for pilot usability or operational safety.
