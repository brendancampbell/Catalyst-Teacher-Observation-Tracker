#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db build
pnpm --filter @workspace/integrations-anthropic-ai build
pnpm --filter @workspace/db exec tsx src/migrate-rubric-domain-rubric-set-id.ts
pnpm --filter @workspace/db exec tsx src/backfill-school-year-id.ts
printf '\n' | pnpm --filter @workspace/db run push-force
cd lib/api-types && npx tsc -p tsconfig.json
