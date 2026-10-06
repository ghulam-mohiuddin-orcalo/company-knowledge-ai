# COMPANY KNOWLEDGE AI

**Business Analysis & Software Requirements Specification**

MVP Product Definition  
Version 1.0 | 06 October 2026

| Document Item | Value |
|---|---|
| Product | Company Knowledge AI |
| Document Type | Business Requirements + Software Requirements Specification |
| Target Release | MVP |
| Primary Audience | Product owner, developers, QA, DevOps, UI/UX |
| Product Model | B2B multi-tenant SaaS |
| Status | Developer handoff baseline |

## 1. Executive Summary

Company Knowledge AI is a private, multi-tenant web application that allows an organization to upload internal knowledge documents and ask natural-language questions against that content. The system retrieves relevant document passages and uses a large language model to generate grounded answers with source citations. The MVP is intended both as a commercially demonstrable product and as a reusable foundation for customer-specific implementations.

## 2. Business Problem

Organizations commonly store policies, SOPs, handbooks, product documentation, onboarding material and other operational knowledge across files. Employees spend time locating the correct document, searching within it, and determining whether the information is current. Generic AI chat tools introduce confidentiality and grounding concerns because answers may not be restricted to the organization's approved source material.

### 2.1 Proposed Solution

- Provide each organization with an isolated private workspace.
- Allow authorized administrators to upload and manage knowledge documents.
- Process documents into searchable semantic knowledge.
- Allow members to ask questions in natural language.
- Generate answers only from retrieved organization content and show supporting sources.
- Explicitly decline to invent an answer when sufficient evidence is not available.

## 3. Business Objectives & Success Criteria

| ID | Objective / Metric | MVP Target |
|---|---|---|
| BO-01 | Reduce time required to find information in approved company documents. | Typical supported question answerable in < 15 seconds end-to-end. |
| BO-02 | Demonstrate trustworthy AI behavior. | Every grounded answer contains one or more source references. |
| BO-03 | Protect organization data. | No cross-organization retrieval or document access. |
| BO-04 | Make knowledge administration simple. | Admin can upload, inspect status and remove a document without developer intervention. |
| BO-05 | Create a reusable commercial foundation. | New organization can be provisioned without code changes. |

## 4. Scope

### 4.1 MVP In Scope

- User authentication and organization membership.
- Organization-level tenant isolation.
- Organization Admin and Member application roles; Platform Admin for operational support.
- PDF, DOCX and TXT document upload.
- Document validation, text extraction, chunking, embedding and indexing.
- Document processing status and error visibility.
- Document listing, metadata view and deletion.
- Natural-language chat against organization knowledge.
- Retrieval-augmented generation (RAG).
- Grounded answers with source citations including document name and source location where available.
- Conversation history for signed-in users.
- Safe no-answer behavior when evidence is insufficient.
- Basic audit events for security-relevant and content-management actions.
- Dockerized deployment and environment-based configuration.

### 4.2 Explicitly Out of Scope for MVP

- Public website chatbot/widget.
- Subscription billing and automated plan enforcement.
- Enterprise SSO/SAML/SCIM.
- Slack, Microsoft Teams, Google Drive, SharePoint or CRM connectors.
- Image/OCR-heavy scanned-document processing.
- Audio/video ingestion.
- Autonomous agents that take external actions.
- Fine-tuning proprietary models.
- Complex per-document ACLs beyond organization membership.
- Advanced analytics, evaluation dashboards and human feedback workflows.
- Mobile native applications.

## 5. Stakeholders & User Roles

| Role | Description | Core Permissions |
|---|---|---|
| Organization Admin | Customer-side administrator responsible for the organization's knowledge base. | Manage documents; view processing status; use chat; manage basic organization membership where enabled. |
| Member | Authenticated employee/user consuming organizational knowledge. | Use chat; view own conversations; open permitted citations. |
| Platform Admin | Operator of the SaaS platform. | Operational visibility across tenants for support; tenant provisioning/suspension; must not casually expose customer document content. |

## 6. Key User Journeys

### 6.1 Admin: Build Knowledge Base

1. Admin signs in and enters the organization workspace.
2. Admin opens Knowledge/Documents and uploads a supported file.
3. System validates file type and size, stores the original file, and creates a processing record.
4. System extracts text, normalizes it, chunks it, creates embeddings and indexes chunks under the organization.
5. UI shows Processing until ingestion completes.
6. On success, status becomes Ready; on failure, status becomes Failed with a safe actionable message.
7. Ready content becomes eligible for retrieval.

### 6.2 Member: Ask a Question

1. Member signs in and starts or opens a conversation.
2. Member enters a question.
3. System retrieves the most relevant chunks only from the member's organization.
4. System evaluates whether retrieved evidence is sufficient.
5. If sufficient, the LLM generates an answer constrained to supplied evidence.
6. System returns the answer with citations and stores the conversation turn.
7. If insufficient, system states that the answer could not be found in the available knowledge instead of fabricating it.

### 6.3 Admin: Remove Knowledge

1. Admin selects a document and requests deletion.
2. System asks for confirmation.
3. System removes or marks unavailable the original document and all derived chunks/embeddings.
4. Deleted content must no longer be returned by subsequent retrieval.

## 7. Functional Requirements

| ID | Area | Requirement | Priority |
|---|---|---|---|
| FR-AUTH-01 | Authentication | The system shall require authentication for all organization knowledge and chat functionality. | Must |
| FR-AUTH-02 | Authentication | The system shall associate every non-platform user with an organization/tenant. | Must |
| FR-AUTH-03 | Authorization | The system shall enforce role-based authorization server-side; UI hiding alone is insufficient. | Must |
| FR-TEN-01 | Tenant Isolation | Every tenant-owned record and retrieval operation shall be scoped to organization_id (or equivalent tenant key). | Must |
| FR-TEN-02 | Tenant Isolation | A user shall never retrieve another organization's documents, chunks, conversations or citations. | Must |
| FR-DOC-01 | Documents | Organization Admin shall be able to upload PDF, DOCX and TXT files. | Must |
| FR-DOC-02 | Documents | The system shall validate allowed file type, configured maximum size and non-empty content before/while processing. | Must |
| FR-DOC-03 | Documents | The system shall display filename, type, size, upload time, uploader and processing status. | Must |
| FR-DOC-04 | Documents | Processing states shall include at minimum Uploaded/Queued, Processing, Ready and Failed. | Must |
| FR-DOC-05 | Documents | Admin shall be able to delete a document and its derived searchable content. | Must |
| FR-DOC-06 | Documents | A failed ingestion shall not expose partially indexed content as Ready. | Must |
| FR-ING-01 | Ingestion | The system shall extract machine-readable text from supported files. | Must |
| FR-ING-02 | Ingestion | Extracted content shall be segmented into chunks suitable for retrieval while retaining source metadata. | Must |
| FR-ING-03 | Ingestion | The system shall generate vector embeddings for chunks and persist them with tenant and document identifiers. | Must |
| FR-ING-04 | Ingestion | Ingestion shall be idempotent or protected from accidental duplicate processing of the same processing job. | Should |
| FR-RET-01 | Retrieval | Search shall be limited to Ready documents belonging to the active organization. | Must |
| FR-RET-02 | Retrieval | The system shall rank candidate chunks by relevance and supply only a bounded set to the generation step. | Must |
| FR-RET-03 | Retrieval | Retrieval shall return source metadata required to construct citations. | Must |
| FR-CHAT-01 | Chat | Member and Admin shall be able to create a conversation and submit natural-language questions. | Must |
| FR-CHAT-02 | Chat | The assistant shall generate an answer grounded in retrieved source content rather than treating model prior knowledge as company truth. | Must |
| FR-CHAT-03 | Chat | Grounded answers shall display citations that identify the source document and a usable location/snippet reference where technically available. | Must |
| FR-CHAT-04 | Chat | When evidence is insufficient, the assistant shall return a clear no-answer response and shall not invent unsupported facts. | Must |
| FR-CHAT-05 | Chat | The system shall persist user and assistant messages for conversation history. | Must |
| FR-CHAT-06 | Chat | Users shall only access conversations they are authorized to access; MVP default is own conversations. | Must |
| FR-CHAT-07 | Chat | The system shall protect prompts from treating instructions found inside uploaded documents as privileged system instructions. | Must |
| FR-AUD-01 | Audit | The system shall record sign-in/security events where available, document upload/delete, ingestion result and privileged admin actions. | Should |
| FR-OPS-01 | Platform Ops | Platform Admin shall be able to identify organizations and inspect operational status necessary for support. | Should |
| FR-ERR-01 | Errors | User-facing errors shall not expose stack traces, secrets, provider credentials or internal prompts. | Must |

## 8. Business Rules

| Rule | Definition |
|---|---|
| BR-01 | Only organization administrators can add or remove organization knowledge documents. |
| BR-02 | Only documents in Ready state are searchable. |
| BR-03 | All tenant-owned entities must carry or derive an unambiguous tenant scope. |
| BR-04 | Citations must originate from the same retrieved evidence used for the answer; citations may not be fabricated by the model. |
| BR-05 | If retrieval confidence/evidence quality is below the configured acceptance policy, the system returns a no-answer response. |
| BR-06 | Deleting a document makes it unavailable for new answers and removes its derived index data. |
| BR-07 | Uploaded document text is untrusted data. Instructions contained in a document must not override system/developer instructions. |
| BR-08 | Secrets and model/provider API keys are platform configuration and are never exposed to tenant users. |
| BR-09 | The MVP does not promise legal, medical, financial or other professional correctness merely because a statement exists in uploaded content. |

## 9. Detailed Acceptance Criteria

| ID | Acceptance Criterion |
|---|---|
| AC-01 Document upload | Given an authenticated Organization Admin and a valid supported document, when the admin uploads it, then a document record is created and processing status is visible. |
| AC-02 Unsupported upload | Given an unsupported file type, when upload is attempted, then the system rejects it with a clear validation message and does not index it. |
| AC-03 Successful ingestion | Given a valid machine-readable document, when processing completes, then its status is Ready and its chunks are retrievable only within the owning organization. |
| AC-04 Failed ingestion | Given extraction or embedding failure, when processing ends, then status is Failed, no partial content is treated as Ready, and the user receives a safe error state. |
| AC-05 Grounded answer | Given relevant indexed content, when a member asks a supported question, then the response answers from retrieved evidence and includes at least one valid citation. |
| AC-06 Unknown answer | Given no sufficient evidence in the organization's indexed content, when a member asks a question, then the assistant states that the answer is not available in the current knowledge base. |
| AC-07 Tenant isolation | Given users in Organization A and Organization B, when either performs document, retrieval or conversation operations, then no data belonging exclusively to the other organization is returned. |
| AC-08 Delete document | Given a Ready document, when an admin confirms deletion, then the document's derived chunks/embeddings become unavailable to retrieval. |
| AC-09 Authorization | Given a Member, when the member attempts an admin-only document mutation through the UI or direct API call, then the server denies the operation. |
| AC-10 Prompt injection resistance | Given a document containing text such as 'ignore previous instructions', when that chunk is retrieved, then it is treated as source data and does not change system authorization or grounding rules. |
| AC-11 Citation integrity | Given an answer with citations, when a citation is opened/resolved, then it maps to an actual source document owned by the active organization and evidence used by that answer. |
| AC-12 Error safety | Given an internal provider or application failure, when an error is returned to the browser, then secrets, raw stack traces and hidden prompts are absent. |

## 10. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-SEC-01 | Security | TLS shall be used in production; passwords/tokens/secrets shall not be logged. |
| NFR-SEC-02 | Security | Authorization and tenant scoping shall be enforced at the API/data-access boundary. |
| NFR-SEC-03 | Security | Uploads shall use allow-listed file formats, generated storage keys, size limits and safe parsing; original filenames shall not control filesystem paths. |
| NFR-SEC-04 | Security | Application shall apply reasonable rate limiting to authentication, upload and chat endpoints. |
| NFR-PRIV-01 | Privacy | Customer content shall not be intentionally sent to third parties other than configured infrastructure/model providers required to provide the service. |
| NFR-PERF-01 | Performance | For normal MVP load, non-AI API requests should target p95 < 500 ms excluding file transfer and external provider latency. |
| NFR-PERF-02 | Performance | Typical chat answer target is < 15 seconds; UI shall visibly indicate generation in progress. |
| NFR-SCALE-01 | Scalability | Design shall support multiple organizations without separate code deployments per tenant. |
| NFR-REL-01 | Reliability | Ingestion failures shall be retryable without corrupting document state or duplicating active index records. |
| NFR-OBS-01 | Observability | Structured logs shall include request/job correlation identifiers and tenant-safe operational context. |
| NFR-OBS-02 | Observability | Health/readiness endpoints shall exist for deployment monitoring. |
| NFR-MNT-01 | Maintainability | Model provider, embedding model, chunking configuration and retrieval limits shall be configurable rather than hard-coded across business logic. |
| NFR-UX-01 | Usability | The core admin upload flow and member ask-question flow shall be usable without technical knowledge. |
| NFR-A11Y-01 | Accessibility | Core screens should follow semantic HTML, keyboard navigation and sufficient form labeling. |

## 11. Information Architecture / Screens

| Screen | Primary Users | Required Content / Actions |
|---|---|---|
| Sign In | All users | Credentials/provider sign-in; validation; recovery entry point if implemented. |
| Dashboard | Admin, Member | Knowledge readiness summary, recent conversations, primary Ask action. |
| Documents | Admin | Document table, upload action, status, metadata, delete action, failure state. |
| Chat | Admin, Member | Conversation list, message thread, question composer, loading state, grounded answer, citations, no-answer state. |
| Organization / Members | Admin | Basic organization details and membership management if included in MVP provisioning path. |
| Platform Operations | Platform Admin | Tenant list/status and limited operational support controls. |

## 12. Conceptual Data Model

| Entity | Indicative Fields | Purpose |
|---|---|---|
| Organization | id, name, status, created_at | Tenant boundary. |
| User | id, email, name, auth_subject, created_at | Identity. |
| Membership | id, organization_id, user_id, role | Maps users to tenant and role. |
| Document | id, organization_id, uploaded_by, filename, storage_key, mime_type, size, status, error_code, created_at | Original knowledge asset metadata. |
| DocumentChunk | id, organization_id, document_id, chunk_index, content, source_metadata, embedding/vector | Retrieval unit. |
| Conversation | id, organization_id, user_id, title, created_at, updated_at | Chat container. |
| Message | id, conversation_id, role, content, created_at | Conversation turn. |
| AnswerCitation | id, message_id, document_id, chunk_id, source_label, excerpt/locator | Server-generated evidence mapping. |
| IngestionJob | id, organization_id, document_id, status, attempts, timestamps, error_code | Processing lifecycle. |
| AuditEvent | id, organization_id?, actor_user_id?, action, target_type, target_id, metadata, created_at | Operational/security trace. |

## 13. Logical System Architecture

Recommended MVP architecture: Next.js web client -> NestJS API -> PostgreSQL with pgvector. Original files are stored in S3-compatible object storage. The API/application worker performs extraction, chunking and embedding. Chat requests execute retrieval against pgvector and call a configured LLM provider with retrieved evidence. For the first implementation, ingestion may use a database-backed job/status mechanism or a simple worker process; RabbitMQ is not required until workload/reliability needs justify it.

| Component | Responsibility |
|---|---|
| Next.js Web | Authentication UX, admin document UI, chat UI, citation rendering. |
| NestJS API | Authorization, tenant boundary, document lifecycle, conversations, retrieval orchestration, provider abstraction. |
| PostgreSQL + pgvector | Application records plus vector index for document chunks. |
| Object Storage | Original uploaded files. |
| Ingestion Worker/Service | Extraction, normalization, chunking, embeddings, state transitions. |
| LLM Provider Adapter | Generation and embedding provider integration behind application interfaces. |
| Observability | Structured logs, error tracking/metrics as deployment permits. |

## 14. RAG Processing Requirements

1. Persist upload metadata and tenant ownership before processing.
2. Extract text using a parser appropriate to the allow-listed format.
3. Normalize text while retaining useful structural metadata such as page/section where available.
4. Chunk using a configurable strategy; store chunk order and source locator.
5. Create embeddings using a configured embedding model.
6. Persist vectors with organization_id and document_id.
7. At query time, create a query embedding and retrieve top candidate chunks scoped to organization_id and Ready documents.
8. Optionally apply lightweight lexical/hybrid or reranking logic if evaluation shows semantic-only retrieval is insufficient; do not add it by default without evidence.
9. Build a generation prompt that clearly separates trusted application instructions from untrusted retrieved content.
10. Generate the answer using only supplied evidence for organization-specific factual claims.
11. Construct citation objects server-side from retrieved chunk metadata rather than asking the model to invent document identifiers.
12. Store answer, retrieval/citation references and timing/token metadata as appropriate for debugging and cost analysis.

## 15. API Capability Requirements

| Capability | Indicative Endpoint Shape | Notes |
|---|---|---|
| Session/User | GET /me | Return active user, tenant and role. |
| Documents | POST /documents | Multipart upload; Admin only. |
| Documents | GET /documents | Tenant-scoped list. |
| Documents | GET /documents/:id | Tenant-scoped metadata/status. |
| Documents | DELETE /documents/:id | Admin only; remove derived index. |
| Conversations | POST /conversations | Create conversation. |
| Conversations | GET /conversations | Own conversation list. |
| Messages | GET /conversations/:id/messages | Authorized conversation only. |
| Ask | POST /conversations/:id/messages | Submit user question and generate/stream assistant response. |
| Citation source | GET /documents/:id/source?... | Authorized source resolution/download/view. |
| Health | GET /health, /ready | Operational endpoints. |

Exact route naming is an implementation decision; the behavioral contracts and authorization requirements are mandatory.

## 16. Security & AI-Specific Threat Requirements

- Treat all uploaded text and user questions as untrusted input.
- Do not allow retrieved document instructions to alter system role, authorization, tenant filters, tool permissions or secret handling.
- Do not place provider secrets in browser code.
- Apply tenant filters before vector similarity results can become application-visible; never rely on post-generation filtering.
- Validate citation/document ownership when resolving a citation.
- Do not render model output as unsanitized HTML.
- Protect upload parsing against path traversal, oversized files and unsupported content.
- Log identifiers and operational metadata, not full confidential documents by default.
- Use least-privilege database/storage credentials in production.
- Include abuse/rate limits sufficient to prevent accidental or trivial cost exhaustion.

## 17. Error & Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Empty or unreadable document | Fail processing with safe message; no Ready index. |
| Password-protected/encrypted file | Reject/fail with unsupported/encrypted-file message. |
| Duplicate upload | MVP may allow duplicates, but UI should make filename/date visible; processing must not duplicate a single job accidentally. |
| Provider timeout | Return retryable chat/processing error; preserve consistent state. |
| Embedding failure mid-job | Job becomes Failed or safely retryable; partial index not searchable. |
| Document deleted during/after processing | Final state must not leave retrievable orphan chunks. |
| Question unrelated to knowledge | Return no-answer/insufficient-evidence behavior. |
| Malicious prompt in document | Treat as quoted/source data, not executable instruction. |
| Very long question | Enforce configured request length and return validation error. |
| User loses membership | Subsequent tenant resources become inaccessible. |

## 18. MVP Analytics / Operational Metrics

- Number of organizations, users and Ready documents.
- Document ingestion success/failure count and processing duration.
- Chat request count and end-to-end latency.
- No-answer rate.
- LLM/embedding token or provider usage where exposed by provider.
- Application errors by operation/provider.
- Do not build a customer-facing analytics dashboard for MVP; structured metrics/logging is sufficient.

## 19. QA & Verification Strategy

- Unit tests: authorization policies, chunking utilities, state transitions, provider adapters and business rules.
- Integration tests: tenant-scoped repository queries, pgvector retrieval, document lifecycle and conversation persistence.
- End-to-end tests: Admin upload -> Ready -> Member question -> citation; delete -> no longer retrievable.
- Security tests: cross-tenant ID manipulation, member calling admin APIs, citation ID tampering, prompt-injection documents, oversized/invalid uploads.
- RAG evaluation set: create a small fixed corpus with known answerable and unanswerable questions; track retrieval hit and grounded-answer behavior before releases.
- Manual UX verification for loading, failed processing, no-answer, long answer and citation interactions.

## 20. Definition of Done - MVP

- All Must functional requirements implemented and tested.
- Tenant-isolation tests pass, including direct API/ID manipulation cases.
- Supported documents can be uploaded, processed, queried and deleted.
- Known-answer evaluation questions produce grounded answers with valid citations at an agreed baseline.
- Unanswerable evaluation questions trigger the no-answer policy rather than unsupported claims.
- Core app can be deployed from documented environment configuration using Docker.
- Database migrations and seed/provisioning instructions are documented.
- No secrets committed to source control; production secret configuration documented.
- Health checks and basic structured logging are available.
- README contains local setup, architecture summary, environment variables, test commands and deployment notes.

## 21. Delivery Plan / Developer Workstreams

| Workstream | Scope | Dependency |
|---|---|---|
| WS-1 Foundation | Repository structure, environments, Docker, DB migrations, auth skeleton. | None |
| WS-2 Tenancy & RBAC | Organizations, membership, role guards, tenant-safe data access. | WS-1 |
| WS-3 Document Management | Upload/storage, metadata, list/delete, status UI/API. | WS-2 |
| WS-4 Ingestion & Vector Index | Extraction, chunking, embeddings, pgvector, job lifecycle. | WS-3 |
| WS-5 Chat & RAG | Conversations, retrieval, grounding prompt, LLM integration, no-answer behavior. | WS-4 |
| WS-6 Citations | Server-side citation mapping and source resolution UI. | WS-5 |
| WS-7 Hardening & QA | Security cases, RAG eval, rate limits, logging, error states. | WS-1 to WS-6 |
| WS-8 Deployment & Demo | Production deployment, seed demo organization/docs, demo script. | WS-7 |

## 22. Suggested Implementation Backlog

| Priority | Backlog Item |
|---|---|
| P0 | Create DB schema/migrations for Organization, User, Membership and tenant-aware repositories. |
| P0 | Implement authentication and server-side RBAC. |
| P0 | Implement document upload to object storage with validation. |
| P0 | Implement document metadata/status API and admin UI. |
| P0 | Implement PDF/DOCX/TXT extraction pipeline. |
| P0 | Implement chunking, embedding generation and pgvector persistence. |
| P0 | Implement tenant-scoped vector retrieval. |
| P0 | Implement conversations/messages and ask flow. |
| P0 | Implement grounding prompt and insufficient-evidence policy. |
| P0 | Implement server-generated citation records and citation UI. |
| P0 | Implement deletion cleanup and retrieval exclusion. |
| P0 | Add tenant isolation/security integration tests. |
| P1 | Add retryable ingestion worker/job mechanism. |
| P1 | Add audit events and operational metrics. |
| P1 | Add streaming responses if provider/application design supports it cleanly. |
| P1 | Add RAG evaluation fixture and release verification script. |

## 23. Assumptions & Decisions to Confirm Before Commercial Release

- Authentication provider choice (e.g., managed auth vs application-managed credentials).
- LLM and embedding provider(s), data-processing terms and target customer privacy requirements.
- Maximum document size, documents per organization and retention policy.
- Whether customer administrators can invite/remove members in the first commercial version.
- Whether source citations should open an in-app extracted view or the original file.
- Hosting region and any customer data residency requirement.
- Commercial pricing, quotas and billing model are intentionally deferred from MVP.

## 24. Phase 2 Candidates

- Google Drive/SharePoint/Notion/Confluence connectors.
- Slack/Microsoft Teams interface.
- Per-document or group-based access controls.
- Hybrid search/reranking based on measured retrieval quality.
- Admin analytics and user feedback/evaluation workflows.
- SSO/SAML/SCIM.
- Billing, quotas and self-service organization provisioning.
- OCR/scanned PDFs and image understanding.
- Versioned documents and freshness/expiry policies.
- External/public support chatbot with a separately controlled knowledge scope.

## 25. Developer Handoff Summary

The implementation priority is correctness of tenant isolation and evidence grounding, not feature breadth. A successful MVP lets an administrator safely create a private searchable knowledge base and lets an authorized member obtain useful, cited answers without cross-tenant leakage or fabricated company facts. Developers may change internal implementation details where appropriate, but any change that alters scope, business rules, security boundaries, acceptance criteria or user-visible behavior should be treated as a product/BA decision and documented.
