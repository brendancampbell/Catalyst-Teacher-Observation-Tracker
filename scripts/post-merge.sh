#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db build
pnpm --filter @workspace/integrations-anthropic-ai build
pnpm --filter @workspace/db exec tsx src/migrate-rubric-domain-rubric-set-id.ts
pnpm --filter @workspace/db exec tsx src/backfill-school-year-id.ts
pnpm --filter @workspace/db exec tsx src/backfill-drizzle-migrations-table.ts
pnpm --filter @workspace/db run generate
# `drizzle-kit migrate` applies every unapplied .sql migration file in order.
# This includes any data statements (UPDATE/INSERT) inside those files.
# ⚠️  DATA BACKFILL NOTE: data backfills that live only in .sql files are
# invisible to environments bootstrapped with `drizzle-kit push`.  Every
# data backfill MUST also exist as an idempotent ensure*() call in
# artifacts/api-server/src/index.ts.  See lib/db/README.md §Data backfills.
pnpm --filter @workspace/db run migrate
cd lib/api-types && npx tsc -p tsconfig.json
pnpm --filter @workspace/db run check:schema-sync
pnpm --filter @workspace/db run check:migration-data
