#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db build
pnpm --filter @workspace/integrations-anthropic-ai build
pnpm --filter @workspace/db tsx src/migrate-rubric-domain-rubric-set-id.ts
pnpm --filter @workspace/db run push-force
cd lib/api-types && npx tsc -p tsconfig.json
