# syntax=docker/dockerfile:1.7
#
# Production images for the monorepo (E9-T01). One Dockerfile, one target per
# deployable process, all built from the same lockfile:
#
#   docker build --target api    -t cka-api .
#   docker build --target worker -t cka-worker .
#   docker build --target web    -t cka-web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
#     --build-arg NEXT_PUBLIC_OIDC_AUTHORITY=https://login.example.com/ \
#     --build-arg NEXT_PUBLIC_OIDC_CLIENT_ID=... .
#
# The API image also runs the explicit deployment steps (migrations,
# provisioning). Runtime configuration comes only from the environment and is
# validated at startup; no secrets are baked into any image. The web app's
# public settings are inlined by Next.js at build time, so the web image is
# built per environment (see docs/deployment/RUNBOOK.md).

ARG NODE_IMAGE=node:24.21.0-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# All workspace dependencies, from the frozen lockfile only. Packages are
# fetched from the lockfile alone, so source changes reuse this layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN --mount=type=cache,id=cka-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm fetch
COPY . .
RUN --mount=type=cache,id=cka-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline

# API + worker: build, then produce self-contained production-only bundles.
FROM deps AS build-backend
RUN pnpm build:packages \
 && pnpm --filter @cka/api --filter @cka/worker build
RUN --mount=type=cache,id=cka-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @cka/api deploy --prod /out/api \
 && pnpm --filter @cka/worker deploy --prod /out/worker

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Files stay root-owned (read-only for the app); processes run unprivileged.
USER node

FROM runtime AS api
COPY --from=build-backend /out/api ./
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=build-backend /out/worker ./
# No HTTP port: the worker fails fast on startup problems and the orchestrator
# restarts it if it exits.
CMD ["node", "dist/main.js"]

# Web: Next.js standalone server. Public (non-secret) settings are build args.
FROM deps AS build-web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_OIDC_AUTHORITY
ARG NEXT_PUBLIC_OIDC_CLIENT_ID
ARG NEXT_PUBLIC_OIDC_SCOPE
ARG NEXT_PUBLIC_OIDC_AUDIENCE
ENV NEXT_STANDALONE=true \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_OIDC_AUTHORITY=${NEXT_PUBLIC_OIDC_AUTHORITY} \
    NEXT_PUBLIC_OIDC_CLIENT_ID=${NEXT_PUBLIC_OIDC_CLIENT_ID} \
    NEXT_PUBLIC_OIDC_SCOPE=${NEXT_PUBLIC_OIDC_SCOPE} \
    NEXT_PUBLIC_OIDC_AUDIENCE=${NEXT_PUBLIC_OIDC_AUDIENCE}
# Fail the build rather than ship a web app that cannot sign in.
RUN for name in NEXT_PUBLIC_API_URL NEXT_PUBLIC_OIDC_AUTHORITY NEXT_PUBLIC_OIDC_CLIENT_ID; do \
      eval "value=\${$name}"; \
      [ -n "$value" ] || { echo "Build argument $name is required for the web image" >&2; exit 1; }; \
    done
RUN pnpm --filter @cka/contracts build \
 && pnpm --filter @cka/web build

FROM runtime AS web
COPY --from=build-web /repo/apps/web/.next/standalone ./
COPY --from=build-web /repo/apps/web/.next/static ./apps/web/.next/static
ENV PORT=3000 \
    HOSTNAME=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]

# Local/CI verification only: the deterministic OpenAI-compatible stand-in used
# by the E2E suite, so production-like runs need no paid AI provider. Never
# deployed to staging or production.
FROM build-backend AS ai-stub
USER node
WORKDIR /repo/tests/e2e
ENV AI_HOST=0.0.0.0
EXPOSE 39102
CMD ["node", "support/fake-ai-server.mjs"]
