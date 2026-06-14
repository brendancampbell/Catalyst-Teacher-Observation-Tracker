#!/bin/bash
set -e
pnpm install --frozen-lockfile
echo "No" | pnpm --filter db push
