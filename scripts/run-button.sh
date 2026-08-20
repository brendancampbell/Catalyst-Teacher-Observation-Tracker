#!/usr/bin/env bash
# What the Replit Run button does.
#
# It used to run the "Project" workflow: mode = "parallel" with 48 validation
# tasks, 12 of which launch Playwright with Chromium. Each task is
# pnpm → node → tool, and every node sizes its V8 worker pool from the HOST's
# core count rather than the container's share, so each one wants 12-20 threads
# before doing any work. Several hundred threads would start at once, while the
# preview was separately trying to start three dev services of its own.
#
# The container refused to create another thread, pthread_create returned
# EAGAIN, and node aborted inside NodePlatform with SIGABRT before loading a
# single line of JavaScript. Whichever process happened to start once the
# ceiling was reached is the one that died, which is why it moved around and
# looked intermittent. Measured 2026-08-20: 270 pids at idle against a
# pids.max of 1024.
#
# The app itself is served by the artifact dev services declared in
# artifacts/*/.replit-artifact/artifact.toml — Replit starts those for the
# preview. The Run button never started the app and does not need to.
set -euo pipefail

cat <<'MSG'
Catalyst — the app is served by the artifact previews, not by this workflow.

  API server          artifacts/api-server          :8080
  Principal dashboard artifacts/catalyst-dashboard  :18277
  Mobile observation  artifacts/catalyst-mobile     :25869

Open a preview to use the app. To run the checks that used to live behind this
button, use the "Validate All" workflow, or run a tier directly:

  pnpm --filter @workspace/api-server run test              # no database, seconds
  pnpm --filter @workspace/api-server run test:integration  # needs a live server
  pnpm --filter @workspace/db      run check:schema-sync

Validate All runs those checks one at a time. That is not a limitation to work
around: they share one dev server and one database, so running them at once is
wrong for correctness as well as for the thread ceiling. The integration suite
is single-threaded by design (--test-concurrency=1) for the same reason.
MSG
