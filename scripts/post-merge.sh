#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db tsx src/migrate-rubric-domain-rubric-set-id.ts
pnpm --filter @workspace/db run push-force
