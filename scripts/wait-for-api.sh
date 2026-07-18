#!/usr/bin/env bash
# Wait for the API dev server to be reachable before running tests.
# Polls http://localhost:PORT/ every 2 s until any HTTP response is received.
# Exits 0 when ready, 1 on timeout.
#
# Usage:
#   bash scripts/wait-for-api.sh          # uses PORT env or defaults to 8080
#   bash scripts/wait-for-api.sh 9000     # override port via positional arg
PORT="${1:-${PORT:-8080}}"
MAX=120
i=0

printf 'Waiting for API server on port %s' "$PORT"
while [ "$i" -lt "$MAX" ]; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 \
    "http://localhost:${PORT}/" 2>/dev/null || true)
  if [ -n "$CODE" ] && [ "$CODE" != "000" ]; then
    printf ' ready (%ds)\n' "$i"
    exit 0
  fi
  printf '.'
  sleep 2
  i=$((i + 2))
done

printf ' TIMED OUT after %ds\n' "$MAX" >&2
exit 1
