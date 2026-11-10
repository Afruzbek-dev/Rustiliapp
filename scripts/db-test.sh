#!/usr/bin/env bash
# Local DB test harness: throwaway Postgres 16 cluster + Supabase auth shim + migrations,
# then the vitest DB suite. The cluster is always stopped and deleted on exit.
#
# Usage (from repo root): bash scripts/db-test.sh [extra vitest args]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PGPORT="${DB_TEST_PORT:-54329}"
DB_NAME="rustili_test"

# initdb refuses to run as root: run the cluster as the `postgres` OS user in that case.
if [ "$(id -u)" -eq 0 ]; then
  PG_OS_USER="postgres"
  as_pg() { runuser -u "$PG_OS_USER" -- "$@"; }
else
  PG_OS_USER="$(whoami)"
  as_pg() { "$@"; }
fi
DB_USER="$PG_OS_USER"

PGDATA="$(mktemp -d /tmp/rustili-pgdata.XXXXXX)"
SOCK_DIR="$(mktemp -d /tmp/rustili-pgsock.XXXXXX)"
LOG_FILE="$SOCK_DIR/postgres.log"

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [ -f "$PGDATA/postmaster.pid" ]; then
    as_pg "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  if [ "$code" -ne 0 ] && [ -s "$LOG_FILE" ]; then
    echo "--- postgres log (tail) ---" >&2
    tail -n 40 "$LOG_FILE" >&2 || true
  fi
  rm -rf "$PGDATA" "$SOCK_DIR"
  exit "$code"
}
trap cleanup EXIT INT TERM

if [ "$(id -u)" -eq 0 ]; then
  chown "$PG_OS_USER" "$PGDATA" "$SOCK_DIR"
fi

if "$PG_BIN/pg_isready" -q -h localhost -p "$PGPORT" >/dev/null 2>&1; then
  echo "db-test: port $PGPORT is already in use (set DB_TEST_PORT to override)" >&2
  exit 1
fi

echo "db-test: initdb in $PGDATA"
as_pg "$PG_BIN/initdb" -D "$PGDATA" -U "$DB_USER" --auth=trust --encoding=UTF8 >/dev/null

as_pg "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOG_FILE" -w \
  -o "-p $PGPORT -k $SOCK_DIR -c listen_addresses=localhost -c fsync=off -c timezone=UTC" \
  start >/dev/null

PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PGPORT" -U "$DB_USER")

"${PSQL[@]}" -d postgres -c "create database $DB_NAME"

echo "db-test: applying supabase/tests/shim.sql"
"${PSQL[@]}" -d "$DB_NAME" -f "$ROOT/supabase/tests/shim.sql"

shopt -s nullglob
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "db-test: applying supabase/migrations/$(basename "$f")"
  "${PSQL[@]}" -d "$DB_NAME" -1 -f "$f"
done

export DATABASE_URL="postgres://$DB_USER@localhost:$PGPORT/$DB_NAME"
cd "$ROOT"
npx vitest run --config vitest.db.config.ts "$@"
