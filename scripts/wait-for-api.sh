#!/usr/bin/env bash
# run-api-test.sh — Start the API dev server if it isn't already running,
# wait until it's reachable, execute the supplied test command, then clean up.
#
# Usage (from artifacts/api-server, via npm script):
#   bash ../../scripts/wait-for-api.sh tsx --test src/my-test.ts
#
# Behaviour:
#   - If the server is already up → check it was built from the current
#     sources, then run tests immediately (fast-path).
#   - If the server is down      → start it in the background, wait up to
#     MAX_WAIT seconds for it to accept requests, run tests, then kill the
#     background process on exit (even if tests fail).
#
# Environment:
#   WAIT_FOR_API_ALLOW_STALE=1  skip the staleness check entirely.
set -euo pipefail

# Exported, not just assigned: the API server reads PORT from its environment
# and exits immediately without it. A bare `PORT=...` assignment is visible to
# this script but NOT to the background server process started below, so the
# server died on boot while this script waited the full timeout for it.
export PORT="${PORT:-8080}"
URL="http://localhost:${PORT}/"
HEALTH_URL="http://localhost:${PORT}/api/healthz"
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

# ── Staleness: is the running server built from the code under test? ─────
# `pnpm run dev` is `build && start`, so a running server is a compiled
# snapshot of the sources as they were when it started. It never picks up a
# later edit. Reusing it is right for speed and wrong after a pull or an edit:
# tsx loads the NEW test files and points them at a server built from the OLD
# code. That has already cost two rounds of failures against a server that
# predated the change being tested, plus one browser crash when the UI outran
# the API.
#
# The build stamps a fingerprint of its sources into the bundle and the server
# reports it on /api/healthz; scripts/source-fingerprint.mjs recomputes it from
# the working tree. Mismatch means the server is stale.
#
# On mismatch this STOPS rather than restarting. The server may belong to
# another terminal — cleanup() already refuses to kill a server it did not
# start, and killing someone's dev session out from under them is a worse
# surprise than a failed command that says exactly what to run.
check_server_freshness() {
  [ "${WAIT_FOR_API_ALLOW_STALE:-0}" = "1" ] && return 0

  local repo_root running current
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

  running="$(curl -s -o /dev/null -D - --max-time 5 "$HEALTH_URL" 2>/dev/null \
    | tr -d '\r' \
    | awk 'tolower($1) == "x-build-fingerprint:" { print $2 }')"

  # No header at all: a server older than this check, or one built before it
  # landed. That is itself a sign it is stale, but "cannot tell" is not proof,
  # so warn and continue rather than blocking a test run on a guess.
  if [ -z "$running" ]; then
    printf 'WARNING: the running server reports no build fingerprint, so it\n' >&2
    printf '         cannot be checked for staleness. If tests fail in ways\n' >&2
    printf '         that make no sense, restart it:\n' >&2
    printf '           pnpm --filter @workspace/api-server run dev\n\n' >&2
    return 0
  fi

  current="$(node "$repo_root/scripts/source-fingerprint.mjs" 2>/dev/null || true)"
  if [ -z "$current" ]; then
    printf 'WARNING: could not compute the source fingerprint; skipping the\n' >&2
    printf '         staleness check.\n\n' >&2
    return 0
  fi

  if [ "$running" != "$current" ]; then
    printf '\nSTALE API SERVER on port %s.\n\n' "$PORT" >&2
    printf '  running server built from : %s\n' "$running" >&2
    printf '  current sources           : %s\n\n' "$current" >&2
    printf 'Tests would run against code that is not the code you changed.\n' >&2
    printf 'Restart the server, then run this again:\n\n' >&2
    printf '  pnpm --filter @workspace/api-server run dev\n\n' >&2
    printf 'To run anyway: WAIT_FOR_API_ALLOW_STALE=1\n\n' >&2
    exit 1
  fi
}

# ── Fast-path: server already running ────────────────────────────────────
if server_is_up; then
  printf 'API server already running on port %s.\n' "$PORT"
  check_server_freshness
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
    # If the server process has already exited there is nothing to wait for.
    # Bail out now rather than burning the full timeout on a dead process.
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      printf ' FAILED\n' >&2
      printf 'The API server exited during startup. Last 30 log lines:\n\n' >&2
      tail -30 /tmp/api-server-bg.log >&2 || true
      exit 1
    fi
    printf '.'
    sleep "$INTERVAL"
    elapsed=$((elapsed + INTERVAL))
  done

  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    printf ' TIMED OUT after %ds\n' "$MAX_WAIT" >&2
    printf 'Last server log:\n' >&2
    tail -30 /tmp/api-server-bg.log >&2 || true
    exit 1
  fi
fi

# ── Run the test command (inherits the pnpm-enriched PATH) ───────────────
"$@"
