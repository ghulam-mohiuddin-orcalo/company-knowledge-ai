#!/bin/sh
# Verifies the local dependency stack (E0-T02 acceptance checks).
set -eu

COMPOSE="docker compose -f $(dirname "$0")/compose.yaml"

echo "Checking PostgreSQL accepts the pgvector extension..."
# Created inside a rolled-back transaction: enabling it permanently is the migration baseline's job (E0-T04).
$COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -tA' <<'SQL'
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
SELECT 'pgvector ' || extversion || ' OK' FROM pg_extension WHERE extname = 'vector';
ROLLBACK;
SQL

echo "Checking bucket bootstrap is repeatable..."
$COMPOSE run --rm storage-init

echo "Checking bucket denies anonymous access..."
$COMPOSE run --rm storage-init '
  if out=$(aws --endpoint-url http://object-storage:8333 --no-sign-request s3api list-objects-v2 --bucket "$S3_BUCKET" 2>&1);
  then echo "Bucket $S3_BUCKET allows anonymous access" >&2; exit 1;
  fi
  case "$out" in
    *AccessDenied*) echo "Anonymous access denied OK" ;;
    *) echo "Unexpected anonymous access result: $out" >&2; exit 1 ;;
  esac'

echo "Local infrastructure OK"
