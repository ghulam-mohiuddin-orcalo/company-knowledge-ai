# Deployment & Operations Runbook

Company Knowledge AI — staging/production deployment, updates, secrets, backups, rollback and recovery (E9-T02, E9-T03). Everything here is exercised by the local rehearsal (`infra/deploy/rehearsal.sh`), which runs the same images, compose file and steps against local stand-ins for the managed services.

## 1. Topology

```
                Internet (HTTPS only: 443, 80 -> redirect)
                                 |
                       +---------+---------+
                       |   edge (Caddy)    |  automatic TLS certificates
                       +----+---------+----+
          https://APP_DOMAIN|         |https://API_DOMAIN
                       +----v--+   +--v---+          +--------+
        network "edge" |  web  |   | api  |          | worker |  (no ingress)
                       +-------+   +--+---+          +---+----+
                                      |  network "backend" |
              -------------------------------------------------------------
              managed PostgreSQL+pgvector   private S3 bucket   OIDC IdP   AI provider
```

| Component | Image / service | Public? | Notes |
| --- | --- | --- | --- |
| edge | `caddy` (official) | Yes: 80/443 | The only service with published ports. HTTPS (Let's Encrypt/ZeroSSL), HSTS, HTTP→HTTPS redirect, 30 MB body cap. |
| web | `Dockerfile` target `web` | Through edge | Next.js standalone server, UI only. Public settings baked in at build time (per environment). |
| api | target `api` | Through edge | NestJS API. Liveness `GET /health`, readiness `GET /ready` (checks PostgreSQL). |
| worker | target `worker` | No | Ingestion/cleanup. No HTTP port; restarted by Docker if it exits. |
| migrate / provision | target `api` (profile `ops`) | No | Explicit one-shot deployment steps. |
| PostgreSQL 15+ with pgvector | managed service | No | Private networking/allow-list to the host only. |
| Object storage | managed S3-compatible bucket | No | Private bucket; the API proxies authorized downloads. |
| Identity provider | managed OIDC | Yes (vendor) | Public SPA client with PKCE. |
| AI provider | OpenAI-compatible | Vendor | Embeddings + generation. |

All containers run as non-root with read-only filesystems. One host with Docker Engine 24+ and Compose v2.24+ is sufficient for staging and a pilot (TDD §27). The images are platform-neutral: on a container platform (ECS, Cloud Run, Azure Container Apps, Fly.io, …) run the same images with the same environment, the platform's TLS load balancer in place of `edge`, and `migrate` as a one-off task.

## 2. One-time environment setup

Do this separately for **each** environment (staging, production). Nothing is shared between environments: separate database, bucket, IdP application, AI key, metrics token and secrets file.

1. **Host**: a Linux VM with Docker Engine and the Compose plugin. Firewall: allow inbound 80 and 443 only (plus SSH from admin IPs). Clone the repository at the release tag (only `infra/deploy` is used at runtime).
2. **DNS**: `A`/`AAAA` records for `APP_DOMAIN` (e.g. `app.staging.example.com`) and `API_DOMAIN` (e.g. `api.staging.example.com`) pointing to the host. Caddy obtains certificates on first start; ports 80/443 must be reachable from the internet for the ACME challenge.
3. **PostgreSQL** (managed, version 15+, pgvector available):
   - Create database `company_knowledge` and an application role that owns it.
   - The first migration runs `CREATE EXTENSION IF NOT EXISTS vector`. If the provider requires a privileged role for extensions, run that statement once as the admin role before the first `migrate`.
   - Require TLS (`?sslmode=verify-full` in `DATABASE_URL`), private networking or an allow-list containing only the host.
   - Enable automated backups with point-in-time recovery (see §7).
4. **Object storage**: a private bucket (block all public access), server-side encryption on, versioning on. Add a lifecycle rule that permanently expires **noncurrent** versions after the agreed retention (e.g. 30 days) so deleted documents do not live forever (the app deletes the current object when a document is deleted). Create an access key limited to `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on this bucket.
5. **Identity provider**: create a *single-page application* client (public, Authorization Code + PKCE, no secret):
   - Allowed callback URL `https://APP_DOMAIN/auth/callback`; allowed logout URL `https://APP_DOMAIN/`; allowed web origin `https://APP_DOMAIN`.
   - Access tokens must be JWTs signed with RS/ES/PS keys, with audience = `AUTH_AUDIENCE` (create an "API" with that identifier if the provider needs one) and containing email and name claims (configure `AUTH_EMAIL_CLAIM`/`AUTH_NAME_CLAIM` for namespaced claims).
   - Note the issuer URL (exact `iss` value), JWKS URL and client ID.
6. **AI provider**: a dedicated API key for the environment with spend limits. Keep `text-embedding-3-small` (1536 dimensions) unless you also plan a migration and re-calibration (`pnpm eval`).
7. **Secrets file**: copy `infra/deploy/production.env.example` to a path **outside the repository** (e.g. `/etc/cka/staging.env`, mode `0600`, owned by the deploy user) or render it from the secret manager at deploy time. Fill every value; secrets marked `[secret]` come from the secret manager. Generate the metrics token with `openssl rand -hex 32`.
8. **Deployment settings** (shell environment or `infra/deploy/.env`, not secret):

   ```bash
   export CKA_ENV_FILE=/etc/cka/staging.env
   export APP_DOMAIN=app.staging.example.com
   export API_DOMAIN=api.staging.example.com
   export ACME_EMAIL=ops@example.com
   export CKA_API_IMAGE=registry.example.com/cka-api:<git-sha>
   export CKA_WORKER_IMAGE=registry.example.com/cka-worker:<git-sha>
   export CKA_WEB_IMAGE=registry.example.com/cka-web:staging-<git-sha>
   ```

## 3. Building release images

Images are built from the repository root `Dockerfile`, one target per process, from the frozen lockfile. Tag with the git commit SHA (immutable); never deploy `latest`.

```bash
SHA=$(git rev-parse --short HEAD)
docker build --target api    -t registry.example.com/cka-api:$SHA .
docker build --target worker -t registry.example.com/cka-worker:$SHA .
# The web image embeds public settings, so it is built per environment:
docker build --target web -t registry.example.com/cka-web:staging-$SHA \
  --build-arg NEXT_PUBLIC_API_URL=https://api.staging.example.com \
  --build-arg NEXT_PUBLIC_OIDC_AUTHORITY=https://login.example.com/ \
  --build-arg NEXT_PUBLIC_OIDC_CLIENT_ID=<spa-client-id> \
  --build-arg NEXT_PUBLIC_OIDC_AUDIENCE=company-knowledge-api   # only if the IdP needs it (e.g. Auth0)
docker push registry.example.com/cka-api:$SHA   # and the other two
```

The web build fails if a required `NEXT_PUBLIC_*` argument is missing. Build-args are public by design (they are visible in the browser); never pass secrets as build arguments. CI builds all images on every change (`deploy-rehearsal` job) but does not push: publishing to a registry is configured once a registry is chosen.

## 4. First deployment

From `infra/deploy` on the host, with the settings from §2.8 exported:

```bash
docker compose pull
docker compose run --rm migrate                      # 1. schema (explicit step)
docker compose run --rm provision \                  # 2. first tenant (see §9)
  --organization 'Acme Ltd' --admin '<idp-subject>:admin@acme.example'
docker compose up -d --wait                          # 3. edge, web, api, worker
./smoke.sh https://$APP_DOMAIN https://$API_DOMAIN   # 4. verify (add PROBE_PORTS=1)
```

`migrate` prints `Database migrations applied`; `up --wait` returns only when web and API report healthy. Then sign in as the provisioned admin and run the demo path ([docs/demo/DEMO_SCRIPT.md](../demo/DEMO_SCRIPT.md)) once.

## 5. Updating an environment (release)

1. Confirm CI is green for the commit (lint, typecheck, unit, integration, security, RAG eval, build, E2E, deployment rehearsal).
2. Build and push the images for the new SHA (§3); update `CKA_*_IMAGE`.
3. If the release contains migrations (`packages/database/migrations/` changed): take an on-demand database snapshot first (§7) and note the time.
4. `docker compose pull && docker compose run --rm migrate`
5. `docker compose up -d --wait` (containers are replaced; in-flight ingestion jobs resume after their lease expires).
6. `./smoke.sh https://$APP_DOMAIN https://$API_DOMAIN`, then sign in and ask one known question.
7. Record the deployed SHA and time (release log/ticket).

**Migration policy.** Migrations are forward-only and must stay compatible with the previous release ("expand, then contract"): add columns/tables first, remove them in a later release. This is what makes image rollback safe. A release whose migration is not backwards compatible must say so in its notes and requires the database-restore rollback path.

## 6. Rollback

| Situation | Action |
| --- | --- |
| New release misbehaves, migrations were additive (normal case) | Set `CKA_*_IMAGE` back to the previous SHA, `docker compose up -d --wait`, run `smoke.sh`. No database change. |
| A migration damaged data or is incompatible | Stop writers (`docker compose stop api worker`), restore the pre-release snapshot/PITR point into a **new** database (§7), point `DATABASE_URL` at it, deploy the previous SHA, smoke test. Changes made after the snapshot are lost: announce the window. |
| Bad configuration/secret | Fix the env file (keep the previous version in the secret manager), `docker compose up -d --wait`. Startup refuses invalid configuration and names the variable. |

Never edit the `drizzle.__drizzle_migrations` table by hand and never delete applied migration files.

## 7. Backups and restore

**Expectations**

| Data | Owner | Backup | Target |
| --- | --- | --- | --- |
| PostgreSQL (all tenant metadata, chunks, vectors, conversations, audit) | Managed provider | Daily automated snapshots + point-in-time recovery; on-demand snapshot before each migration | Retention ≥ 7 days (staging), ≥ 30 days (production); RPO ≤ 15 min with PITR; RTO ≤ 4 h |
| Object storage (original documents) | Managed provider | Bucket versioning; noncurrent versions expire per retention rule | Same retention as the database |
| Configuration/secrets | Secret manager | Versioned secrets | Previous version always restorable |
| TLS certificates | `caddy-data` volume | Re-issued automatically if lost | — |

Chunks and vectors are derived data: after a storage-only incident, documents can be re-uploaded to rebuild them.

**Restore procedure** (rehearsed with the rehearsal stack; run a restore test at least quarterly):

1. Restore the provider snapshot or PITR point into a new database (never over the live one).
2. Verify: `SELECT count(*) FROM drizzle.__drizzle_migrations;` matches the release, `SELECT extversion FROM pg_extension WHERE extname = 'vector';` returns a version, and row counts of `organizations`, `documents`, `messages` look right.
3. Point `DATABASE_URL` at the restored database, `docker compose up -d --wait`, run `smoke.sh` and a sign-in.

Without provider snapshots (self-managed PostgreSQL): `pg_dump --format=custom` regularly to separate storage, restore with `createdb <new> && pg_restore --no-owner -d <new> backup.dump`.

## 8. Recovery basics

| Symptom | Meaning | Action |
| --- | --- | --- |
| `/ready` → 503 `database: down`, `/health` → 200 | API cannot reach PostgreSQL | Check provider status/network/credentials. The API recovers by itself when the database returns (no restart needed); requests fail with safe 503 errors meanwhile. |
| Worker container restarting | Startup check failed (configuration or database) or crash | `docker compose logs worker`: the first lines name the invalid variable or the database error. In-flight jobs are retried after `JOB_LEASE_MS`. |
| Documents stuck in `PROCESSING` | Worker down or provider very slow | Ensure the worker runs; jobs are reclaimed after the lease (default 10 min) and retried up to `JOB_MAX_ATTEMPTS`, then marked `FAILED`. |
| Documents `FAILED` with `INGESTION_ATTEMPTS_EXHAUSTED` | AI provider unavailable for all attempts | Fix the provider issue; ask the admin to upload the document again. |
| Questions fail with 503 `AI_PROVIDER_UNAVAILABLE` | AI provider down or slower than `AI_REQUEST_TIMEOUT_MS` | Check provider status and key/spend limits; users can retry (idempotent). |
| Many `429 RATE_LIMITED` | Limits reached (per IP or per user) | Check `/metrics` and logs for abuse; adjust `RATE_LIMIT_*` if legitimate. |
| Browser shows sign-in loop/`401` | Issuer/audience/claims mismatch | Compare the token's `iss`/`aud` with `AUTH_ISSUER_URL`/`AUTH_AUDIENCE`; confirm callback URLs (§2.5). |
| Certificate errors | ACME failed | `docker compose logs edge`; DNS must point at the host and ports 80/443 be open. |

Correlate problems with the `X-Request-Id` response header (also in the error envelope): every API log line for that request carries it; ingestion logs carry `jobId`. Logs are structured JSON on stdout (`docker compose logs`); ship them to the platform's log store. They never contain document text, prompts or secrets.

**Secret rotation**: update the value in the secret manager, regenerate the env file, `docker compose up -d --wait`. Rotate the database password and S3 key with an overlap (create new, deploy, then revoke old). Rotating the metrics token requires updating the scraper.

## 9. Tenant provisioning

There is no self-service onboarding in the MVP. Operators provision organizations and their first members with the `provision` step; people are linked on first sign-in by their IdP subject (`sub` claim; find it in the IdP's user list):

```bash
docker compose run --rm provision --organization 'Acme Ltd' \
  --admin 'auth0|64f0c2…:jane@acme.example' \
  --member 'auth0|64f0c3…:sam@acme.example'
```

It is idempotent (re-running changes nothing), transactional, audited (`ORGANIZATION_PROVISIONED`, `MEMBERSHIP_GRANTED`) and refuses to change an existing member's role. Locally: `pnpm db:provision --organization … --admin …`. `pnpm db:seed:demo` is for local development only and refuses `NODE_ENV=production`.

## 10. Operations reference

- **Health**: `GET /health` (liveness, no dependencies) and `GET /ready` (PostgreSQL) on the API; web container health is its home page. Both are exempt from rate limits.
- **Metrics**: `GET https://API_DOMAIN/metrics` with `Authorization: Bearer $METRICS_TOKEN` (Prometheus format: HTTP latency/errors, ingestion duration/failures, retrieval/generation latency, no-answer rate, provider usage). No tenant/user/document identifiers in labels.
- **Audit**: `audit_events` table (provisioning, uploads, deletions, ingestion results, platform listings).
- **Rate limits** (fixed window, in memory, per API instance): per client IP for every request (600/min) and failed sign-ins (20/min); per user for questions (20/min) and uploads (30/min). The edge passes the real client IP and the API trusts exactly that one hop (`TRUST_PROXY=1`), so clients cannot spoof their IP. If another proxy/load balancer is placed in front of the edge, configure Caddy `trusted_proxies` and set `TRUST_PROXY=2`.
- **Scaling**: run one API container per environment in this topology (in-memory limits are then exact). Running N API replicas multiplies the effective limits by N; acceptable for small N if limits are divided accordingly, otherwise move the limiter to a shared store (PostgreSQL or Redis) at that point. Workers can be scaled freely (`docker compose up -d --scale worker=2`): jobs are claimed with `FOR UPDATE SKIP LOCKED`.

## 11. Rehearsing locally

`infra/deploy/rehearsal.sh` deploys the full topology on one machine with real TLS (Caddy's local CA) on `https://app.localhost` / `https://api.localhost`, a private PostgreSQL+pgvector, private object storage, the mock IdP (served at `https://auth.localhost`) and the deterministic AI stand-in. It needs ports 80 and 443 free.

```bash
pnpm deploy:rehearsal up        # build, migrate, provision demo tenant, start
pnpm deploy:rehearsal smoke     # infra/deploy/smoke.sh + published-port/health checks
DEPLOY_LOCAL_CA=1 pnpm test:deploy   # demo path in Chromium against the deployment
pnpm deploy:rehearsal down      # stop (keeps data); `destroy` also deletes its volumes
```

Sign in at https://app.localhost (accept the local certificate, or import the CA printed by `pnpm deploy:rehearsal ca`) as `demo-admin` or `demo-member` with claims `{"email":"demo-admin@example.test","name":"Demo Admin","aud":"company-knowledge-api"}`. CI runs the same rehearsal on every change.
