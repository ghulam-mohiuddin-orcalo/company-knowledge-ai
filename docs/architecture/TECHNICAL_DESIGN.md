# COMPANY KNOWLEDGE AI

**Technical Design Document (TDD)**

MVP Engineering Baseline  
Version 1.0 | 06 October 2026

| Item | Decision |
|---|---|
| Architecture | Modular monolith with separately runnable ingestion worker boundary |
| Frontend | Next.js App Router + TypeScript |
| Backend | NestJS + TypeScript |
| Database | PostgreSQL + pgvector |
| Object Storage | S3-compatible object storage |
| AI | Provider adapters for chat/completion and embeddings |
| Deployment | Dockerized web/API/worker + managed PostgreSQL/object storage |
| Primary Design Priorities | Tenant isolation, grounded answers, citation integrity, maintainability |
| Source Requirements | Company Knowledge AI BA Requirements v1.0 |

## 1. Purpose

This document translates the approved MVP business requirements into an implementable technical design. It defines system boundaries, modules, data structures, API behavior, RAG processing, security controls, deployment topology, testing strategy and implementation order. Internal implementation details may evolve, but changes affecting tenant isolation, authorization, grounding, citation integrity or BA acceptance criteria require explicit review.

## 2. Architecture Principles

- Start as a modular monolith. Do not introduce microservices merely to create service boundaries.
- Keep ingestion executable as a separate worker process so asynchronous infrastructure can evolve without restructuring domain logic.
- Enforce tenant scope in backend/data-access code before data is returned; never rely on frontend filtering.
- Treat uploaded documents and user prompts as untrusted content.
- Separate AI provider integrations behind application interfaces so model/provider changes do not leak through domain modules.
- Construct citations from retrieval metadata server-side; the LLM may format citation markers but must not invent source identifiers.
- Prefer configuration and measured evaluation over hard-coded RAG assumptions.
- Use explicit state machines for document/ingestion lifecycle and idempotent processing.

## 3. High-Level Architecture

```
Browser
  |
  v
Next.js Web (UI / session integration)
  |
  v
NestJS API
  |-- Auth / Tenant / RBAC
  |-- Documents ------------------> S3-compatible Object Storage
  |-- Conversations / Messages
  |-- Retrieval / RAG ------------> PostgreSQL + pgvector
  |-- Provider Adapters ----------> LLM / Embedding Provider
  |
  +---- creates ingestion job/state
             |
             v
       Ingestion Worker
       extract -> normalize -> chunk -> embed -> index
             |
             +---------------------> PostgreSQL + pgvector
```

## 4. Runtime Components

| Component | Responsibilities | Scaling Boundary |
|---|---|---|
| web | Next.js pages/components, auth UX, document administration, chat/citations. | Stateless horizontal scaling. |
| api | NestJS REST API, authorization, tenant context, document metadata, conversations, retrieval/RAG orchestration. | Stateless horizontal scaling; DB/provider constrained. |
| worker | Document extraction/chunking/embedding and ingestion state transitions. | Scale independently when ingestion volume justifies it. |
| postgres | Transactional data and pgvector embeddings. | Managed PostgreSQL preferred; vertical/read/index tuning first. |
| object-storage | Original uploaded documents. | Managed S3-compatible service. |
| AI providers | Embedding and answer generation. | External dependency behind adapters. |

## 5. Repository / Code Organization

Recommended monorepo. Exact package manager may be pnpm/npm; pnpm workspaces is a reasonable default.

```
apps/
  web/                    # Next.js
  api/                    # NestJS HTTP application
  worker/                 # NestJS application context / ingestion runner
packages/
  contracts/              # shared DTO-compatible types/schemas where appropriate
  config/                 # shared configuration primitives
  eslint-config/
  tsconfig/
infra/
  docker/
  migrations/             # if not owned by ORM package
docs/
  architecture/
  api/
  rag-evaluation/

```

Do not share ORM entities/repositories directly with the browser. Shared packages are for stable contracts/utilities, not bypassing backend boundaries.

## 6. Backend Module Design

| NestJS Module | Responsibilities | Key Dependencies |
|---|---|---|
| AuthModule | Authentication integration, principal resolution, session/JWT verification. | Auth provider adapter. |
| TenancyModule | Active organization context, membership lookup, tenant guards/policies. | Users/Memberships. |
| OrganizationsModule | Organization lifecycle and platform operations. | Tenancy, Audit. |
| UsersModule | User profile and identity mapping. | Auth. |
| DocumentsModule | Upload initiation, metadata, status, deletion, source authorization. | Storage, Ingestion, Audit. |
| IngestionModule | Jobs, extraction orchestration, chunking, embedding, indexing. | Documents, AI Embeddings, Vector Store. |
| ConversationsModule | Conversation ownership and message persistence. | Tenancy. |
| RetrievalModule | Tenant-scoped semantic retrieval and retrieval policy. | pgvector, Documents. |
| RagModule | Ask flow, evidence policy, prompt construction, generation, citations. | Retrieval, AI, Conversations. |
| AiModule | LLM and embedding provider interfaces/adapters. | External providers. |
| StorageModule | Object storage abstraction, signed/internal object operations. | S3-compatible storage. |
| AuditModule | Security/content-management event recording. | Database. |
| HealthModule | Liveness/readiness and dependency checks. | Database/provider checks as configured. |

## 7. Frontend Design

- Use Next.js App Router with authenticated application routes.
- Server components may load stable page data; interactive upload/chat experiences use client components where necessary.
- Do not place AI/provider credentials or direct privileged storage credentials in the browser.
- All authorization decisions remain backend responsibilities even when UI controls are role-gated.
- Recommended route groups: /auth, /app, /app/documents, /app/chat/[conversationId], /app/settings, and platform-only routes if operational UI is built.
- Use a small typed API client generated or manually maintained from stable contracts; avoid duplicating backend validation rules as security controls.

## 8. Authentication, Tenancy & RBAC

### 8.1 Principal Model

Authentication may be implemented using a managed identity provider or application-owned auth. Backend normalizes the authenticated identity into an internal principal containing userId, activeOrganizationId, membershipId and role. Provider-specific claims must not become the domain authorization model.

```
Request -> verify identity -> resolve internal User -> resolve active Membership
        -> build Principal { userId, organizationId, role }
        -> authorize operation -> execute tenant-scoped repository query
```

### 8.2 Roles

| Role | Allowed MVP Operations |
|---|---|
| MEMBER | Create/read own conversations; ask questions; resolve authorized citations. |
| ORG_ADMIN | MEMBER capabilities + upload/list/delete organization documents; optional member management. |
| PLATFORM_ADMIN | Tenant operational administration; privileged actions explicitly audited. |

### 8.3 Tenant Isolation Rules

- Every tenant-owned table includes organization_id unless ownership is unambiguously inherited and query APIs still require tenant context.
- Repositories/services accepting tenant-owned identifiers also accept tenant context; avoid generic findById(id) for tenant resources.
- Vector queries include organization_id and Ready-document constraints inside the SQL query.
- Object storage keys are generated by the server and tenant-prefixed, e.g. org/{organizationId}/documents/{documentId}/original.
- Citation resolution rechecks organization ownership and user authorization.
- Cross-tenant tests are mandatory for every new tenant-owned aggregate.

## 9. Database Design

PostgreSQL is the system of record. UUID/UUIDv7-style identifiers are recommended. Timestamps use timestamptz. Soft deletion is not required universally; use explicit lifecycle/status where business behavior needs it.

| Table | Important Columns / Constraints |
|---|---|
| organizations | id PK, name, status, created_at, updated_at |
| users | id PK, auth_subject UNIQUE, email, display_name, created_at, updated_at |
| memberships | id PK, organization_id FK, user_id FK, role, UNIQUE(organization_id,user_id) |
| documents | id PK, organization_id FK, uploaded_by FK, filename, storage_key UNIQUE, mime_type, size_bytes, sha256?, status, error_code, created_at, updated_at |
| ingestion_jobs | id PK, organization_id FK, document_id FK, status, attempt, idempotency_key UNIQUE, started_at, completed_at, error_code, error_detail_safe |
| document_chunks | id PK, organization_id FK, document_id FK, chunk_index, content, token_count?, page_number?, section_path?, char_start?, char_end?, embedding vector(N), UNIQUE(document_id,chunk_index) |
| conversations | id PK, organization_id FK, user_id FK, title, created_at, updated_at |
| messages | id PK, conversation_id FK, role, content, model?, latency_ms?, input_tokens?, output_tokens?, created_at |
| answer_citations | id PK, message_id FK, organization_id FK, document_id FK, chunk_id FK, ordinal, source_label, excerpt, locator_json |
| audit_events | id PK, organization_id nullable, actor_user_id nullable, action, target_type, target_id, metadata_json, created_at |

### 9.1 Recommended Indexes

- memberships(user_id, organization_id) and memberships(organization_id, role).
- documents(organization_id, status, created_at DESC).
- document_chunks(organization_id, document_id).
- Vector index appropriate to pgvector/operator class and expected dataset; start with supported approximate index only after corpus size/latency requires it, otherwise exact search is acceptable for small MVP datasets.
- conversations(organization_id, user_id, updated_at DESC).
- messages(conversation_id, created_at).
- answer_citations(message_id, ordinal).
- audit_events(organization_id, created_at DESC).

## 10. Document Lifecycle

```
UPLOADED/QUEUED -> PROCESSING -> READY
                         |
                         +-> FAILED
READY -> DELETING -> DELETED (or physical removal after cleanup)
```

- Only READY documents participate in retrieval.
- Transition to READY occurs only after all active chunks for the ingestion version are committed.
- Deletion first makes the document ineligible for retrieval, then removes chunks/embeddings and object storage data.
- Worker retries must not create multiple active chunk sets for the same job/version.

## 11. Upload & Storage Design

- API validates role, MIME/extension allow-list, configured size and basic file signature where practical.
- Generate document ID and server-controlled object key; never use user filename as a filesystem/object path.
- Persist document metadata before starting ingestion.
- For MVP, API may stream upload to object storage. Direct-to-S3 presigned upload can be introduced later for large files.
- Store original filename only as metadata for display.
- Compute SHA-256 during/after upload if useful for integrity/duplicate visibility; duplicate rejection is not an MVP requirement.
- Do not expose public bucket/object access. Citation source access is authenticated through API or short-lived signed URLs after authorization.

## 12. Ingestion Pipeline

1. Claim a queued ingestion job using an idempotency/locking strategy.
2. Set document/job to PROCESSING.
3. Read original object from storage.
4. Select extractor by validated MIME type.
5. Extract text plus page/section metadata where available.
6. Reject empty/unusable extracted content.
7. Normalize whitespace/control characters while preserving useful structure.
8. Chunk using configured token-aware chunk size and overlap.
9. Generate embeddings in bounded batches.
10. Persist chunks and vectors transactionally or using a versioned staging approach that prevents partial data becoming searchable.
11. Mark job/document READY only after successful persistence.
12. On failure, clean/stage partial data as required, store safe error code, and mark FAILED.

### 12.1 Chunking Baseline

Do not treat initial chunk numbers as permanent product requirements. Start with a configurable token-aware strategy, for example 600-900 tokens with 10-20% overlap, preserving page/section boundaries where possible. Evaluate against the fixed RAG test corpus and tune based on retrieval quality, latency and cost.

## 13. RAG / Ask Request Sequence

```
POST message
  -> authenticate + resolve tenant
  -> authorize conversation
  -> persist USER message
  -> normalize query
  -> embed query
  -> tenant-scoped retrieval
  -> evidence sufficiency policy
      -> insufficient: persist safe no-answer ASSISTANT message
      -> sufficient:
           build prompt(system rules + evidence + question)
           call LLM
           validate/normalize answer
           create citation records from retrieved evidence
           persist ASSISTANT message + citations
  -> return/stream response
```

## 14. Retrieval Design

- Baseline retrieval: vector similarity over document_chunks scoped by organization_id and documents.status=READY.
- Top-K is configuration, not a public contract. Start small (e.g. retrieve 8-12 candidates) and pass a smaller evidence set after filtering/deduplication.
- Prevent one document or adjacent overlapping chunks from unnecessarily dominating evidence; deduplicate/merge adjacent chunks when useful.
- Return internal RetrievalHit objects containing chunkId, documentId, content, similarity/distance and source metadata.
- Do not add Elasticsearch, a separate vector database or reranker for MVP unless evaluation demonstrates a concrete need.
- Hybrid lexical search is a Phase 1 optimization only if the evaluation corpus shows failures on exact identifiers, codes or terminology.

## 15. Evidence Sufficiency & No-Answer Policy

A single similarity threshold is not assumed to be universally reliable. Implement an EvidencePolicy interface so the initial heuristic can evolve. The baseline may combine minimum retrieval score/distance, presence of at least one strong chunk and prompt-level instruction to abstain. The acceptance test is behavioral: unanswerable evaluation questions must not produce unsupported company facts.

```
interface EvidencePolicy {
  evaluate(query: string, hits: RetrievalHit[]): {
    sufficient: boolean;
    selectedHits: RetrievalHit[];
    reason?: string;
  };
}
```

## 16. Prompt Construction

- System instructions define role, grounding rules, no-answer behavior and treatment of retrieved content as untrusted evidence.
- Evidence is inserted in a clearly delimited data section with stable internal labels such as SOURCE_1, SOURCE_2.
- Uploaded text is never concatenated into system/developer instruction text as if trusted.
- Prompt tells the model to cite only provided source labels and to avoid unsupported organization-specific claims.
- API maps SOURCE_n back to retrieved chunk metadata; unknown source labels from model output are ignored/rejected.
- Do not expose hidden prompts in user-facing errors or logs.

## 17. Citation Design

Citation integrity is enforced by application data, not model creativity.

1. Retrieval assigns each selected hit a transient source label.
2. Prompt includes source label and source text.
3. Model may reference those labels in its answer.
4. Backend parses recognized labels only.
5. Backend creates AnswerCitation rows from the corresponding RetrievalHit IDs and metadata.
6. Response returns structured citation objects with citationId, document display name, locator and optional excerpt.
7. Opening a citation authorizes tenant/user access again before serving the source.

```
{
  "message": {
    "id": "msg_...",
    "role": "assistant",
    "content": "Employees may ... [1]"
  },
  "citations": [
    {
      "id": "cit_...",
      "ordinal": 1,
      "documentId": "doc_...",
      "documentName": "Employee Handbook.pdf",
      "locator": { "page": 12 },
      "excerpt": "..."
    }
  ]
}
```

## 18. AI Provider Abstraction

```
interface EmbeddingProvider {
  embedTexts(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

interface GenerationProvider {
  generate(request: GenerationRequest): Promise<GenerationResult>;
  // streaming method may be added without changing RagService domain contract
}
```

- Provider adapters own SDK-specific request/response mapping, retryable error classification and usage extraction.
- Domain services should not import provider SDK types.
- Embedding dimension is tied to the configured model and database vector column/migration; changing incompatible dimensions requires controlled re-indexing.
- Store model/provider identifiers with generated messages/jobs for debugging and reproducibility where practical.

## 19. API Contracts

| Method / Route | Auth | Behavior / Key Response |
|---|---|---|
| GET /v1/me | User | Internal user, active organization, role. |
| GET /v1/documents | Member/Admin; admin UI | Tenant-scoped documents; pagination/status. |
| POST /v1/documents | ORG_ADMIN | Multipart upload; returns document with queued/processing state. |
| GET /v1/documents/:id | Authorized tenant user | Metadata/status; no raw storage key. |
| DELETE /v1/documents/:id | ORG_ADMIN | Marks unavailable and triggers cleanup; idempotent behavior preferred. |
| POST /v1/conversations | Member/Admin | Create own conversation. |
| GET /v1/conversations | Member/Admin | Own conversations. |
| GET /v1/conversations/:id/messages | Owner | Messages + structured citations. |
| POST /v1/conversations/:id/messages | Owner | Persist question; execute RAG; return/stream answer. |
| GET /v1/citations/:id/source | Authorized tenant user | Resolve citation to authorized source view/download. |
| GET /health | Public/internal | Liveness only. |
| GET /ready | Infrastructure | Readiness of required dependencies. |

### 19.1 Error Envelope

```
{
  "error": {
    "code": "DOCUMENT_UNSUPPORTED_TYPE",
    "message": "This file type is not supported.",
    "requestId": "req_..."
  }
}
```

Use stable machine-readable codes. Never return raw provider errors, stack traces, SQL details, storage keys or secrets.

## 20. Validation & DTO Strategy

- Validate request DTOs at the NestJS boundary with a single consistent validation approach.
- Reject unknown/invalid values where appropriate rather than silently coercing security-sensitive fields.
- Server derives organizationId, userId, roles, document ownership and storage keys; clients do not choose trusted ownership fields.
- Limit question length, filename metadata length, pagination size and upload size.
- Normalize but do not destructively rewrite user questions before storing them.

## 21. Background Job Strategy

MVP does not require RabbitMQ. Use a durable database-backed ingestion job record plus a separately runnable worker. The worker polls/claims queued jobs with row locking or another safe claim mechanism. This provides crash visibility and retry state without introducing a broker.

```
SELECT ... FROM ingestion_jobs
WHERE status = 'QUEUED'
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

- Job attempts are bounded and errors classified retryable/non-retryable.
- Use exponential backoff or next_attempt_at if automatic retries are implemented.
- Later migration to RabbitMQ/SQS can keep IngestionService/domain pipeline unchanged; only job transport/consumer changes.
- Do not run long ingestion synchronously in the HTTP request.

## 22. Concurrency & Consistency

- Use database transactions for lifecycle transitions that must remain consistent.
- Use row locking/idempotency key to prevent two workers processing the same job.
- Deletion makes a document non-searchable before asynchronous cleanup.
- Conversation message creation should prevent duplicate assistant generations on client retry using request/idempotency IDs if streaming/retry behavior makes duplication likely.
- Do not hold DB transactions open across LLM/provider network calls; persist state around external calls instead.

## 23. Security Design

| Threat | Control |
|---|---|
| Cross-tenant data access | Principal-derived tenant context; tenant-scoped repository methods; vector SQL filter; integration tests. |
| IDOR | Every document/conversation/citation lookup includes tenant/ownership authorization. |
| Prompt injection in documents | Retrieved text treated as untrusted evidence; no tools/actions; system rules isolated. |
| Malicious model HTML/Markdown | Render through safe Markdown pipeline; disallow/sanitize raw HTML. |
| File upload abuse | Allow-list formats, size limits, safe parsers, generated object keys; malware scanning can be added for commercial deployment. |
| Secret leakage | Server-only secrets, redacted logs, safe errors, secret manager/environment injection. |
| Cost abuse | Rate limits, question/upload limits, provider timeouts, optional tenant quotas later. |
| SQL injection | Parameterized ORM/query builder; carefully parameterized pgvector SQL. |
| Storage exposure | Private bucket; authorized proxy or short-lived signed access. |
| Privilege escalation | Server-side role policies; platform admin actions explicitly separated/audited. |

## 24. Observability

- Generate requestId for HTTP requests and jobId for ingestion; propagate into structured logs.
- Log operation, status, latency, tenant ID/user ID where appropriate, but avoid full document content and full prompts by default.
- Metrics: API latency/error rate, ingestion duration/failures, retrieval latency, generation latency, no-answer rate, provider usage/cost signals.
- Capture provider/model name and classified provider errors.
- Readiness checks PostgreSQL and any dependency strictly required to serve traffic; avoid making liveness dependent on external AI provider availability.

## 25. Configuration

| Area | Examples |
|---|---|
| Database | DATABASE_URL |
| Object Storage | endpoint/region/bucket/access credentials |
| Authentication | issuer/client IDs/secrets/provider configuration |
| AI Generation | provider, model, API credential, timeout, max output tokens |
| Embeddings | provider, model, dimensions, batch size |
| RAG | chunk size, overlap, retrieval K, evidence policy thresholds |
| Uploads | allowed MIME types, max bytes |
| Jobs | poll interval, max attempts, retry policy |
| App | public URL, CORS/trusted origins, log level |

Exact environment variable names should be centralized in a validated configuration module. Application startup must fail fast for missing required configuration.

## 26. Docker & Local Development

```
docker compose:
  postgres (pgvector extension)
  object-storage (e.g. MinIO for local development)
  api
  worker
  web

```

- Production should use managed PostgreSQL/object storage where practical rather than running stateful services in the application container stack.
- Run migrations explicitly as a deployment step, not opportunistically from every replica.
- Provide seed/dev scripts for a demo organization, admin/member accounts (or auth-provider test setup), and sample documents.
- Health checks should support compose/deployment dependency ordering without hiding real startup failures.

## 27. Deployment Topology

For the first hosted demo/commercial pilot, deploy web, API and worker as separate processes/services from the same monorepo. Use managed PostgreSQL with pgvector enabled and private S3-compatible storage. API and worker share database/storage credentials via secret management. Only web/API are internet-facing; worker and database are private where the platform supports it.

- HTTPS at edge/load balancer.
- Database backups enabled.
- Object storage lifecycle/retention aligned with document deletion requirements.
- Separate dev/staging/production configuration and credentials.
- CI runs lint, typecheck, unit/integration tests and build before deployment.

## 28. Testing Strategy

| Layer | Required Coverage |
|---|---|
| Unit | Evidence policy, chunking, lifecycle transitions, RBAC policies, provider error mapping. |
| Repository/Integration | Tenant-scoped CRUD, vector retrieval filters, deletion behavior, transaction/state consistency. |
| API Integration | Role enforcement, IDOR/cross-tenant attempts, validation/error envelopes. |
| Worker Integration | Valid/invalid files, retries, partial failure, idempotent job claim. |
| E2E | Upload -> Ready -> Ask -> cited answer; unknown question -> no-answer; delete -> no retrieval. |
| RAG Evaluation | Fixed corpus with answerable/unanswerable questions, expected source documents, retrieval hit checks and groundedness review. |
| Security | Prompt injection corpus, cross-tenant identifiers, citation tampering, upload abuse cases. |

## 29. RAG Evaluation Baseline

Before tuning retrieval, create a small deterministic evaluation corpus (for example 5-10 documents and 30-50 questions). Each question records whether it is answerable and, if answerable, the expected source document/page or section. This becomes the regression set.

| Metric | Meaning |
|---|---|
| Retrieval hit rate | Expected supporting source appears in retrieved candidate set. |
| Citation correctness | Returned citation maps to evidence supporting the answer. |
| Unsupported-answer rate | Unanswerable questions that incorrectly receive factual company answers; should be minimized aggressively. |
| Answer usefulness | Human review that answer directly addresses the question using source evidence. |
| Latency / cost | Track after correctness baseline is acceptable. |

## 30. Requirement Traceability

| BA Requirement Area | Technical Design Coverage |
|---|---|
| FR-AUTH / FR-TEN | Sections 8, 9, 19, 23, 28 |
| FR-DOC | Sections 10, 11, 19, 22 |
| FR-ING | Sections 12, 18, 21, 22 |
| FR-RET | Sections 14, 15, 29 |
| FR-CHAT | Sections 13, 15, 16, 17, 19 |
| FR-AUD / FR-OPS | Sections 6, 24 |
| FR-ERR | Sections 19, 23, 24 |
| NFR Security/Privacy | Sections 8, 11, 16, 23, 25, 27 |
| NFR Performance/Scale | Sections 4, 14, 21, 24, 27 |
| NFR Reliability/Observability | Sections 10, 12, 21, 22, 24, 28 |

## 31. Implementation Sequence

| Phase | Deliverable | Exit Condition |
|---|---|---|
| 1. Foundation | Monorepo, config validation, Docker local stack, DB/pgvector migrations, CI skeleton. | All apps boot; migration/health checks pass. |
| 2. Identity & Tenancy | Auth principal, organizations, memberships, RBAC/tenant repositories. | Cross-tenant integration tests pass. |
| 3. Documents | Upload/storage/list/status/delete metadata flow. | Admin can safely manage stored files. |
| 4. Ingestion | Worker, extractors, chunking, embeddings, vector persistence, job states. | Sample documents reach READY reliably. |
| 5. Retrieval | Tenant-scoped vector query + evidence objects. | Eval expected sources retrieved at baseline. |
| 6. Chat/RAG | Conversations, messages, prompt builder, generation, no-answer policy. | Answerable/unanswerable flows pass. |
| 7. Citations | Structured citation persistence/resolution/UI. | Citation integrity tests pass. |
| 8. Hardening | Rate limits, audit/logging, failure/retry cases, security tests. | BA Must requirements/DoD pass. |
| 9. Deployment/Demo | Hosted environment, sample tenant/docs, runbook. | Repeatable demo and deployment verified. |

## 32. Key Engineering Decisions / ADR Candidates

| ADR | Decision |
|---|---|
| ADR-001 | Use modular monolith rather than microservices for MVP. |
| ADR-002 | Use PostgreSQL + pgvector rather than separate vector database. |
| ADR-003 | Use database-backed ingestion jobs before RabbitMQ/SQS. |
| ADR-004 | Use server-constructed citation records from retrieval metadata. |
| ADR-005 | Keep AI providers behind GenerationProvider/EmbeddingProvider interfaces. |
| ADR-006 | Use organization-scoped shared database schema rather than database-per-tenant. |

Create short ADR files when implementation begins, including context, decision, consequences and triggers for revisiting each choice.

## 33. When the Simple Architecture Stops Being Enough

| Signal | Likely Evolution |
|---|---|
| Ingestion backlog/throughput becomes operationally significant | Introduce RabbitMQ/SQS/Kafka-style job transport depending workload; scale workers. |
| Vector corpus becomes too large/slow for tuned pgvector | Evaluate partitioning/index tuning first; then dedicated vector/search infrastructure if measured need remains. |
| Customers require complex document permissions | Add document/group ACL model and permission-aware retrieval filters. |
| Exact identifiers/keyword queries fail frequently | Add PostgreSQL full-text/hybrid retrieval or a search engine based on evaluation. |
| Enterprise customers require identity lifecycle | Add SSO/SAML/SCIM. |
| Multiple product surfaces need independent release/scaling | Revisit service extraction around proven module boundaries. |

## 34. Developer Definition of Ready

- BA requirements v1.0 and this TDD are available to the team.
- Authentication provider and initial LLM/embedding provider are selected before their implementation tasks begin.
- Embedding dimension/model is confirmed before production vector migration/indexing.
- Sample knowledge corpus and RAG evaluation questions exist before retrieval tuning.
- Deployment target and secret/config mechanism are known before production deployment work.
- Any deviation affecting tenant isolation, role permissions, document lifecycle, grounding or citations is raised before implementation.

## 35. Final Technical Baseline

Build a secure multi-tenant modular monolith with a Next.js frontend, NestJS API and ingestion worker, PostgreSQL/pgvector, private object storage and provider-abstracted AI integrations. Optimize first for tenant isolation, document lifecycle correctness, grounded retrieval and citation integrity. Avoid distributed infrastructure until measured load or customer requirements make it necessary.
