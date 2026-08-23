#!/usr/bin/env bash
# test-db.sh — run a command against a throwaway PostgreSQL.
#
# Usage:
#   bash scripts/test-db.sh pnpm --filter @workspace/api-server run test:integration
#   TEST_DB_KEEP=1 bash scripts/test-db.sh ...   # try to leave the database up
#
# On failure it prints the school years and assignments before shutting down,
# so a failing run carries its own evidence. TEST_DB_DUMP=0 turns that off.
#
# Starts a private Postgres inside this workspace, migrates it, seeds it, runs
# the command with DATABASE_URL pointed at it, then stops it and deletes
# everything. Nothing touches the dev database.
#
# ── Why ───────────────────────────────────────────────────────────────────
# The integration suite has only ever run against the dev database, because
# nothing could produce a working one from empty — no script creates a school
# year, and every route filters on the active one, so a fresh database cannot
# serve a request.
#
# Three backlog items came out of that single fact: tests leaving debris in a
# database people use, a flake that is one test seeing what another left
# behind, and fixtures guessing at what exists. Forty-nine files sharing one
# long-lived database is the cause of all of them.
#
# ── The Postgres it uses ──────────────────────────────────────────────────
# The binaries already present in this Repl (the postgresql-16 Nix module), so
# there is nothing to install and no second database to provision or pay for.
# It listens on a unix socket in its own temp directory rather than a TCP port,
# which means concurrent runs cannot collide and nothing is exposed.
set -euo pipefail

if ! command -v initdb >/dev/null 2>&1; then
  printf 'ERROR: initdb not found.\n' >&2
  printf 'This needs the postgresql module that .replit already loads.\n' >&2
  printf 'Outside Replit, install PostgreSQL client tools and re-run.\n' >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  printf 'Usage: bash scripts/test-db.sh <command...>\n' >&2
  exit 64
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGTMP="$(mktemp -d "${TMPDIR:-/tmp}/catalyst-testdb.XXXXXX")"
PGDATA="$PGTMP/data"
PGSOCK="$PGTMP/sock"
DBNAME="catalyst_test"

# ── Always clean up, however we leave ────────────────────────────────────
# Including on failure: a Postgres left running would hold the socket
# directory and quietly consume one of the container's process slots, which is
# how the Run button used to take the whole workspace down.
# What the database looked like when the command finished. Printed on failure,
# because a failing test and the state that caused it are only useful together
# — and the database is gone moments later.
#
# TEST_DB_KEEP was meant to cover this by leaving Postgres up, but pnpm tears
# down the process group on a non-zero exit and takes the server with it. This
# runs inside the script, so nothing can pull the floor out from under it.
dump_state() {
  printf '\n───── database state at exit ─────\n' >&2
  psql "$DATABASE_URL" -X -q >&2 <<'SQL' || true
\echo '-- school years'
SELECT id, name, status FROM school_years ORDER BY id;
\echo '-- assignments per year'
SELECT school_year_id,
       count(*) FILTER (WHERE end_date IS NULL) AS open_now,
       count(*) AS total
  FROM assignments GROUP BY 1 ORDER BY 1;
\echo '-- who holds an open assignment, by year'
SELECT school_year_id, user_id
  FROM assignments WHERE end_date IS NULL
 ORDER BY school_year_id, user_id;
SQL
  printf '──────────────────────────────────\n\n' >&2
}

cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ -d "$PGDATA" ] && [ "${TEST_DB_DUMP:-1}" = "1" ]; then
    dump_state
  fi
  # TEST_DB_KEEP leaves it up so a failure can be inspected. Without this, a
  # test that disagrees with the database takes its evidence with it — which
  # is exactly the position the school-year suites left us in.
  if [ "${TEST_DB_KEEP:-0}" = "1" ]; then
    printf '\nDatabase kept for inspection. Connect with:\n'
    printf '  psql "%s"\n' "$DATABASE_URL"
    printf '\nStop and delete it when done:\n'
    printf '  pg_ctl -D %s -m immediate stop && rm -rf %s\n' "$PGDATA" "$PGTMP"
    exit "$rc"
  fi
  if [ -d "$PGDATA" ]; then
    pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$PGTMP"
  exit "$rc"
}
trap cleanup EXIT INT TERM

mkdir -p "$PGSOCK"

printf 'Creating a throwaway database...\n'
# -N: no fsync. This database is discarded in a few minutes; durability buys
# nothing and costs a great deal of time on a container filesystem.
initdb -D "$PGDATA" -U postgres --auth=trust -N >/dev/null

pg_ctl -D "$PGDATA" -o "-k '$PGSOCK' -c listen_addresses=''" -w -l "$PGTMP/postgres.log" start >/dev/null
createdb -h "$PGSOCK" -U postgres "$DBNAME"

export DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$PGSOCK"
export NODE_ENV="${NODE_ENV:-development}"
# The suite starts its own server via wait-for-api.sh; it must not reuse one
# already running against the dev database.
export PORT="${TEST_DB_PORT:-8099}"

printf 'Applying migrations...\n'
cd "$REPO_ROOT"
pnpm --filter @workspace/db run migrate >/dev/null

printf 'Seeding...\n'
pnpm --filter @workspace/db exec tsx src/seed-test-db.ts

printf '\nRunning: %s\n\n' "$*"
"$@"
