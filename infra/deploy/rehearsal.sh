#!/usr/bin/env bash
# Production-like deployment rehearsal on this machine (E9-T02 verification).
# Runs the same steps as a hosted deployment (docs/deployment/RUNBOOK.md):
# build images, migrate, provision, start, verify. Requires Docker and free
# ports 80/443; serves https://app.localhost and https://api.localhost.
#
#   infra/deploy/rehearsal.sh up        build + deploy + provision demo tenant
#   infra/deploy/rehearsal.sh smoke     deployment smoke test
#   infra/deploy/rehearsal.sh ca        print the path of the local CA certificate
#   infra/deploy/rehearsal.sh logs      service logs (add -f to follow)
#   infra/deploy/rehearsal.sh down      stop (data volumes are kept)
#   infra/deploy/rehearsal.sh destroy   stop and delete the rehearsal's own volumes
set -euo pipefail

cd "$(dirname "$0")"
export CKA_ENV_FILE=local.env
export CKA_WEB_IMAGE=cka-web:rehearsal
export CKA_API_IMAGE=cka-api:rehearsal
export CKA_WORKER_IMAGE=cka-worker:rehearsal
export APP_DOMAIN=app.localhost
export API_DOMAIN=api.localhost
export ACME_EMAIL=unused@rehearsal.invalid # local CA only; no ACME
APP_URL=https://app.localhost
API_URL=https://api.localhost
CA_FILE=${CA_FILE:-${TMPDIR:-/tmp}/cka-rehearsal-ca.crt}

compose() { docker compose -f compose.yaml -f compose.local.yaml "$@"; }

export_ca() {
  compose cp edge:/data/caddy/pki/authorities/local/root.crt "$CA_FILE" >/dev/null
}

case "${1:-}" in
  up)
    compose build
    # Backing services (managed services in a hosted environment).
    compose up -d --wait postgres object-storage oidc ai-stub
    compose run --rm storage-init
    # Explicit deployment step: migrations before the new release starts.
    compose run --rm migrate
    # Demo tenant; the mock IdP's usernames are the token subjects.
    compose run --rm provision --organization 'Demo Organization' \
      --admin demo-admin:demo-admin@example.test \
      --member demo-member:demo-member@example.test
    compose up -d --wait edge web api worker
    export_ca
    echo "Rehearsal deployed: $APP_URL (API $API_URL). Local CA: $CA_FILE"
    ;;
  smoke)
    export_ca
    CA_FILE="$CA_FILE" RESOLVE_LOCAL=1 METRICS_TOKEN=rehearsal-metrics-token-not-secret \
      ./smoke.sh "$APP_URL" "$API_URL"
    # Only the edge publishes ports; nothing else is reachable from outside.
    published=$(compose ps --format '{{.Service}} {{.Publishers}}' |
      awk '$1 != "edge" && $0 ~ /PublishedPort:[1-9]/ {print $1}')
    [[ -z "$published" ]] || { echo "FAIL services publish ports: $published" >&2; exit 1; }
    echo 'PASS only the TLS edge publishes ports'
    compose ps --format '{{.Service}} {{.Health}}' | awk '
      ($1=="api" || $1=="web") && $2!="healthy" {print "FAIL " $1 " is " $2; bad=1}
      END {exit bad}' >&2
    echo 'PASS web and API containers healthy'
    ;;
  ca)
    export_ca
    echo "$CA_FILE"
    ;;
  logs) compose logs "${@:2}" ;;
  down) compose down ;;
  destroy) compose down --volumes ;;
  *)
    sed -n '2,13p' "$0"
    exit 2
    ;;
esac
