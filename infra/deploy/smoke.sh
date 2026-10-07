#!/usr/bin/env bash
# Deployment smoke test (E9-T02/T05) for any environment:
#
#   infra/deploy/smoke.sh https://app.example.com https://api.example.com
#
# Options (environment):
#   CA_FILE=path      trust this CA (e.g. the rehearsal's local CA); TLS is
#                     always verified, never skipped
#   RESOLVE_LOCAL=1   resolve the hostnames to 127.0.0.1 (rehearsal)
#   PROBE_PORTS=1     check that only 80/443 answer on the public hosts
#   METRICS_TOKEN=... also check the token-gated metrics scrape works
#
# Exits non-zero on the first failed check. Prints no secrets or content.
set -euo pipefail

APP_URL=${1:?usage: smoke.sh <app-url> <api-url>}
API_URL=${2:?usage: smoke.sh <app-url> <api-url>}
APP_HOST=$(printf '%s' "$APP_URL" | sed -E 's#^https?://([^/:]+).*#\1#')
API_HOST=$(printf '%s' "$API_URL" | sed -E 's#^https?://([^/:]+).*#\1#')

CURL=(curl --silent --show-error --max-time 15)
[[ -n "${CA_FILE:-}" ]] && CURL+=(--cacert "$CA_FILE")
if [[ "${RESOLVE_LOCAL:-}" == 1 ]]; then
  for host in "$APP_HOST" "$API_HOST"; do
    CURL+=(--resolve "$host:443:127.0.0.1" --resolve "$host:80:127.0.0.1")
  done
fi

pass() { printf 'PASS %s\n' "$1"; }
fail() {
  printf 'FAIL %s\n' "$1" >&2
  exit 1
}
status() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@"; }
headers() { "${CURL[@]}" -o /dev/null -D - "$@" | tr -d '\r'; }

[[ "$APP_URL" == https://* && "$API_URL" == https://* ]] ||
  fail 'public URLs use https'

# TLS: certificates must validate (curl verifies by default).
[[ $(status "$APP_URL/") == 200 ]] || fail "web over valid TLS ($APP_URL)"
pass 'web served over valid TLS'
[[ $(status "$API_URL/health") == 200 ]] || fail 'API liveness over valid TLS'
pass 'API liveness (/health) over valid TLS'

ready=$("${CURL[@]}" "$API_URL/ready")
[[ "$ready" == *'"status":"ok"'* && "$ready" == *'"database":"up"'* ]] ||
  fail "API readiness (/ready): $ready"
pass 'API readiness (/ready): database up'

redirect=$("${CURL[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "http://$APP_HOST/")
[[ "$redirect" =~ ^30[178]\ https:// ]] || fail "HTTP redirects to HTTPS ($redirect)"
pass 'HTTP redirects to HTTPS'

web_headers=$(headers "$APP_URL/")
for header in 'strict-transport-security' 'content-security-policy' 'x-frame-options: DENY' 'x-content-type-options: nosniff'; do
  grep -qi "^$header" <<<"$web_headers" || fail "web header $header"
done
grep -qi '^x-powered-by' <<<"$web_headers" && fail 'web hides X-Powered-By'
pass 'web security headers (HSTS, CSP, framing, nosniff)'

body=$("${CURL[@]}" -w '\n%{http_code}' "$API_URL/v1/me")
[[ "${body##*$'\n'}" == 401 ]] || fail 'unauthenticated API call is refused'
[[ "$body" == *'"error"'* && "$body" == *'"requestId"'* ]] || fail 'error envelope'
grep -qiE 'stack|at [A-Za-z]+ \(|select ' <<<"$body" && fail 'error leaks internals'
pass 'unauthenticated API call refused with safe error envelope'

[[ $(status "$API_URL/v1/documents") == 401 ]] || fail 'tenant data requires sign-in'
pass 'tenant data requires sign-in'

metrics=$(status "$API_URL/metrics")
[[ "$metrics" == 401 || "$metrics" == 404 ]] || fail "metrics without token ($metrics)"
if [[ -n "${METRICS_TOKEN:-}" ]]; then
  [[ $(status -H "authorization: Bearer $METRICS_TOKEN" "$API_URL/metrics") == 200 ]] ||
    fail 'metrics scrape with token'
  pass 'metrics scrape gated by token'
else
  pass 'metrics not public'
fi

app_origin=$(printf '%s' "$APP_URL" | sed -E 's#^(https://[^/]+).*#\1#')
allowed=$(headers -X OPTIONS "$API_URL/v1/me" -H "Origin: $app_origin" \
  -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization')
grep -qi "^access-control-allow-origin: $app_origin" <<<"$allowed" || fail 'CORS allows the web origin'
denied=$(headers -X OPTIONS "$API_URL/v1/me" -H 'Origin: https://evil.example' \
  -H 'Access-Control-Request-Method: GET')
grep -qi '^access-control-allow-origin' <<<"$denied" && fail 'CORS refuses other origins'
pass 'CORS allows only the web origin'

if [[ "${PROBE_PORTS:-}" == 1 ]]; then
  for host in "$APP_HOST" "$API_HOST"; do
    for port in 3000 3001 5432 8333 39102; do
      if timeout 3 bash -c "</dev/tcp/$host/$port" 2>/dev/null; then
        fail "port $port is not reachable on $host"
      fi
    done
  done
  pass 'only HTTP(S) is reachable on the public hosts'
fi

printf 'Deployment smoke test passed for %s and %s\n' "$APP_URL" "$API_URL"
