#!/bin/bash
set -e

# Leave a durable trace of every run. Whether this script actually fires has
# been guesswork: .replit's [postMerge] is Replit-managed, the git hook only
# fires for shell merges, and neither leaves evidence once the output scrolls
# away. Migration 0009 reached the database unapplied and nobody could say
# which path had failed to run.
#
# .git/ is never committed and survives pulls, so the log outlives the merge
# that wrote it. Read it with:
#   tail -20 "$(git rev-parse --absolute-git-dir)/post-merge-runs.log"
_pm_log="$(git rev-parse --absolute-git-dir)/post-merge-runs.log"
_pm_head="$(git rev-parse --short HEAD)"
_pm_start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
_pm_src="${POST_MERGE_SOURCE:-replit-or-manual}"
printf '%s  START %s  via=%s\n' "$_pm_start" "$_pm_head" "$_pm_src" >> "$_pm_log"

# Log the outcome too — a timeout-kill or mid-way failure is exactly the case
# worth recording, and it is the one a success-only log would miss.
_pm_finish() {
  local rc=$?
  local status=DONE
  [ "$rc" -ne 0 ] && status=FAIL
  printf '%s  %-5s %s  via=%s rc=%d started=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$status" "$_pm_head" "$_pm_src" "$rc" "$_pm_start" >> "$_pm_log"
}
trap _pm_finish EXIT

pnpm install --frozen-lockfile
pnpm --filter @workspace/db build
pnpm --filter @workspace/integrations-anthropic-ai build
pnpm --filter @workspace/db exec tsx src/backfill-school-year-id.ts
pnpm --filter @workspace/db exec tsx src/backfill-drizzle-migrations-table.ts
pnpm --filter @workspace/db run generate
# Guard: reject any migration that contains DML without the required ⚠️ banner.
# Running BEFORE migrate ensures an unbannered migration is caught before it
# touches the database, avoiding a partial post-merge failure state.
bash scripts/check-migration-data-stmts.sh
pnpm --filter @workspace/db run check:migration-data
# `drizzle-kit migrate` applies every unapplied .sql migration file in order.
# This includes any data statements (UPDATE/INSERT) inside those files.
# ⚠️  DATA BACKFILL NOTE: data backfills that live only in .sql files are
# invisible to environments bootstrapped with `drizzle-kit push`.  Every
# data backfill MUST also exist as an idempotent ensure*() call in
# artifacts/api-server/src/index.ts.  See lib/db/README.md §Data backfills.
pnpm --filter @workspace/db run migrate
cd lib/api-types && npx tsc -p tsconfig.json
pnpm --filter @workspace/db run check:schema-sync
