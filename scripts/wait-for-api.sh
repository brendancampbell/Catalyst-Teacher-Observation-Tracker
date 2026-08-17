#!/usr/bin/env bash
# run-api-test.sh — Start the API dev server if it isn't already running,
# wait until it's reachable, execute the supplied test command, then clean up.
#
# Usage (from artifacts/api-server, via npm script):
#   bash ../../scripts/wait-for-api.sh tsx --test src/my-test.ts
#
# Behaviour:
#   - If the server is already up → run tests immediately (fast-path).
#   - If the server is down      → start it in the background, wait up to
#     MAX_WAIT seconds for it to accept requests, run tests, then kill the
#     background process on exit (even if tests fail).
set -euo pipefail

PORT="${PORT:-8080}"
URL="http://localhost:${PORT}/"
MAX_WAIT=120
INTERVAL=2
STARTED_SERVER=0
SERVER_PID=""

# ── Cleanup: kill the background server only if we started it ─────────────
cleanup() {
  if [ "$STARTED_SERVER" -eq 1 ] && [ -n "$SERVER_PID" ]; then
    printf '\nStopping background API server (PID %s)...\n' "$SERVER_PID"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ── Probe: returns 0 if the server answers any HTTP request ───────────────
# Uses curl's exit status, which is 0 for any HTTP response (including 404
# or 500) and non-zero when the connection itself fails. That is exactly the
# question being asked, so no status-code parsing is needed.
#
# The previous implementation captured '%{http_code}' with a `|| echo "000"`
# fallback. On a refused connection curl writes "000" to stdout AND exits
# non-zero, so the fallback appended a second "000" — producing "000000",
# which is not equal to "000", so the probe reported the server as UP when it
# was down. The effect was that this script could never actually start a
# server: it always took the fast path, and every test failed with
# ECONNREFUSED unless a server happened to be running already.
server_is_up() {
  curl -s -o /dev/null --max-time 2 "$URL" >/dev/null 2>&1
}

# ── Fast-path: server already running ────────────────────────────────────
if server_is_up; then
  printf 'API server already running on port %s.\n' "$PORT"
else
  # ── Slow-path: start the dev server in the background ────────────────
  printf 'API server not detected on port %s — starting it...\n' "$PORT"

  # Resolve the workspace root relative to this script's location.
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

  (cd "$REPO_ROOT" && pnpm --filter @workspace/api-server run dev \
     > /tmp/api-server-bg.log 2>&1) &
  SERVER_PID=$!
  STARTED_SERVER=1

  # ── Wait for the server to become reachable ───────────────────────────
  elapsed=0
  printf 'Waiting for API server'
  while [ "$elapsed" -lt "$MAX_WAIT" ]; do
    if server_is_up; then
      printf ' ready (%ds)\n' "$elapsed"
      break
    fi
    printf '.'
    sleep "$INTERVAL"
    elapsed=$((elapsed + INTERVAL))
  done

  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    printf ' TIMED OUT after %ds\n' "$MAX_WAIT" >&2
    printf 'Last server log:\n' >&2
    tail -20 /tmp/api-server-bg.log >&2 || true
    exit 1
  fi
fi

# ── Run the test command (inherits the pnpm-enriched PATH) ───────────────
"$@"
