# MVP Release Checklist

E9-T05. Run for every release candidate; record results and sign-off below. The last run is recorded for the release candidate on branch `feature/e9-deployment-demo-readiness` (2026-10-07).

## 1. Automated gates

| Gate | Command / CI job | Result (2026-10-07) |
| --- | --- | --- |
| Lint, typecheck, formatting | `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Pass |
| Unit tests | `pnpm test` | 268 passed |
| Integration (tenant-scoped data, lifecycle, recovery, provisioning) | `pnpm test:integration` | 201 passed |
| Security regression suite (cross-tenant IDOR, role bypass, citation tampering, prompt injection, invalid uploads, unsafe rendering, abuse controls) | `pnpm test:security` | 51 passed |
| RAG evaluation vs committed baseline (offline) | `pnpm eval` | 3 passed (no regression) |
| Production build | `pnpm build` | Pass |
| Browser E2E + browser security (Chromium) | `pnpm test:e2e` | 15 passed |
| Production images build | `deploy-rehearsal` job / `pnpm deploy:rehearsal up` | Pass (api, worker, web) |
| Images refuse invalid configuration | `deploy-rehearsal` job | Pass (api and worker exit with named variables) |
| Deployment smoke: valid TLS, HTTP→HTTPS, `/health`, `/ready` (database up), security headers, safe 401s, metrics gated, CORS, only the edge publishes ports | `pnpm deploy:rehearsal smoke` | Pass (11 checks) |
| Demo path on the deployment (upload→Ready, cited answer + source, member read-only, no-answer, member API delete → 403, delete → not answered) | `DEPLOY_LOCAL_CA=1 pnpm test:deploy` | 6 passed, repeatable |

## 2. Deployment and recovery checks (rehearsal, 2026-10-07)

| Check | Result |
| --- | --- |
| Fresh deployment from zero with the runbook steps (migrate → provision → up) | Pass: 7 migrations applied, demo tenant provisioned, all services healthy |
| Migrations/provisioning are idempotent on re-run | Pass |
| Client IP cannot be spoofed through the edge (`X-Forwarded-For`) | Pass: forged IPs still throttled (429) |
| Database outage: `/ready` 503 while `/health` 200; automatic recovery | Pass (recovered in 2 s after the database returned) |
| Worker process exit: restarted automatically | Pass |
| Backup (`pg_dump`) and restore into a new database | Pass: identical row counts, migrations and pgvector extension |
| Logs contain no document text, questions, credentials or tokens | Pass (API and worker logs after the demo path) |

## 3. BA Definition of Done (BA §20)

| Item | Status | Evidence |
| --- | --- | --- |
| All Must functional requirements implemented and tested | Met | E1–E8 suites; E2E product flows |
| Tenant-isolation tests pass, including direct API/ID manipulation | Met | `pnpm test:security` (cross-tenant, IDOR, citation tampering) |
| Supported documents can be uploaded, processed, queried and deleted | Met | E2E, demo path |
| Known-answer evaluation questions produce grounded answers with valid citations at an agreed baseline | Met (offline baseline) | `pnpm eval`; see exception X-2 for real-model calibration |
| Unanswerable questions trigger the no-answer policy | Met | `pnpm eval`, E2E, demo path |
| Core app can be deployed from documented environment configuration using Docker | Met | `Dockerfile`, `infra/deploy`, RUNBOOK; rehearsal |
| Migrations and seed/provisioning instructions documented | Met | RUNBOOK §4, §5, §9; README |
| No secrets committed; production secret configuration documented | Met | `.gitignore` (env files), `production.env.example`, RUNBOOK §2.7; images contain no secrets |
| Health checks and basic structured logging available | Met | `/health`, `/ready`, JSON logs with request/job IDs |
| README: local setup, architecture, environment variables, test commands, deployment notes | Met | README |

## 4. Ticket status

All P0 tickets E0-T01 … E9-T05 are implemented, and so are the P1 tickets E7-T04, E7-T05, E8-T02 and E8-T05. E9-T02 is complete as a deployable, verified production-like deployment; the hosted staging run is exception X-1.

## 5. Exceptions and known limitations

Each item needs explicit acceptance (section 6) before a customer pilot.

| ID | Exception / limitation | Impact | Plan |
| --- | --- | --- | --- |
| X-1 | **Hosted staging not yet provisioned.** No hosting provider, managed PostgreSQL, bucket, IdP tenant, DNS or AI key has been chosen (TDD §34 prerequisite). The deployment was verified as a production-like rehearsal (same images, compose file and steps; real TLS; private database/storage) rather than on managed services. | The E9-T02 acceptance checks (HTTPS, exposure, migrations, readiness) are proven in the rehearsal, not yet on the target platform. | Choose the platform and accounts, then follow RUNBOOK §2–§4 and record `smoke.sh` (with `PROBE_PORTS=1`) and a manual demo run here. Estimated half a day once accounts exist. |
| X-2 | **Real AI provider not yet evaluated.** RAG evaluation, E2E and the demo ran against the deterministic offline stand-in. Evidence thresholds for `text-embedding-3-small` are design defaults. | Answer quality, latency (NFR-PERF-02, under 15 s) and abstention rate with the real model are unmeasured. | With the staging AI key: `EVAL_PROVIDERS=configured pnpm eval`, calibrate `EVIDENCE_MIN_*`, commit that baseline (docs/rag-evaluation). |
| X-3 | The web image is built per environment, because Next.js inlines the public settings at build time. | One extra build per environment. | Accepted for MVP; runtime config injection can come later. |
| X-4 | Rate limits are in memory, per API instance. | Exact with the documented single API container; N replicas multiply the limits. | Move to a shared store (PostgreSQL/Redis) before running more than one API replica (RUNBOOK §10). |
| X-5 | Browser sessions end when the access token expires (no silent renew); users sign in again. | Minor UX. | Accept; enable refresh/silent renew per chosen IdP later. |
| X-6 | No self-service onboarding or member-management UI. Operators provision tenants with the `provision` CLI. | Admin effort per tenant. | In line with BA scope (§23 decision pending). |
| X-7 | Uploads are not malware-scanned. Scanned/image-only PDFs are rejected (no OCR). | Documented TDD/BA scope. | Commercial hardening / Phase 2. |
| X-8 | The app does not audit individual sign-ins: credentials are checked at the IdP. It audits a user's first sign-in (`USER_PROVISIONED`), and failed token checks are throttled but not audited. | FR-AUD-01 is a "Should" requirement, met where the app sees the event. | Use the IdP's sign-in logs. |
| X-9 | Answers are returned complete, not streamed. The UI shows progress while generating. | BA P1 item. | Optional later. |

## 6. Sign-off

| Role | Name | Decision (accept exceptions X-1 … X-9 / reject) | Date |
| --- | --- | --- | --- |
| Product owner | | | |
| Engineering lead | | | |
