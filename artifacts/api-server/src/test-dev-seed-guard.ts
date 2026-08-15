/**
 * Regression guard: the production safety guard in seed-dev.ts and
 * seed-dev-extra-obs.ts must reject non-local DATABASE_URL values and
 * exit with code 1 before touching the database.
 *
 * Tests run the scripts as child processes so the actual process.exit(1)
 * behaviour is exercised, not just the conditional logic.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REMOTE_URL = "postgres://user:pass@host.example.com/mydb";
const LOCAL_URL  = "postgres://user:pass@localhost/devdb";

/** Run a seed script as a subprocess with the given env overrides. */
function runSeed(
  script: "seed-dev.ts" | "seed-dev-extra-obs.ts",
  env: Record<string, string>,
  timeoutMs = 8_000,
) {
  return spawnSync(
    "tsx",
    [path.join(__dirname, script)],
    {
      env:      { ...process.env, ...env },
      encoding: "utf8",
      timeout:  timeoutMs,
    },
  );
}

// ── seed-dev.ts ────────────────────────────────────────────────────────────

test("seed-dev: remote DATABASE_URL → exits 1 with guard error", () => {
  const r = runSeed("seed-dev.ts", {
    DATABASE_URL: REMOTE_URL,
    NODE_ENV:     "development",
    DEV_SEED_FORCE: "",
  });
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status}`);
  assert.ok(
    (r.stderr as string).includes("ERROR: seed-dev refuses"),
    `expected guard error in stderr.\nstderr: ${r.stderr}`,
  );
});

test("seed-dev: NODE_ENV=production with local URL → exits 1 with guard error", () => {
  const r = runSeed("seed-dev.ts", {
    DATABASE_URL: LOCAL_URL,
    NODE_ENV:     "production",
    DEV_SEED_FORCE: "",
  });
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status}`);
  assert.ok(
    (r.stderr as string).includes("ERROR: seed-dev refuses"),
    `expected guard error in stderr.\nstderr: ${r.stderr}`,
  );
});

test("seed-dev: DEV_SEED_FORCE=true bypasses remote-URL guard", () => {
  const r = runSeed("seed-dev.ts", {
    DATABASE_URL:   REMOTE_URL,
    NODE_ENV:       "development",
    DEV_SEED_FORCE: "true",
  });
  // Guard must NOT fire — the specific guard message must be absent.
  // (The script may still fail due to a real DB connection error; that's expected.)
  assert.ok(
    !(r.stderr as string).includes("ERROR: seed-dev refuses"),
    `guard should not fire when DEV_SEED_FORCE=true.\nstderr: ${r.stderr}`,
  );
});

test("seed-dev: DEV_SEED_FORCE=true bypasses production-env guard", () => {
  const r = runSeed("seed-dev.ts", {
    DATABASE_URL:   LOCAL_URL,
    NODE_ENV:       "production",
    DEV_SEED_FORCE: "true",
  });
  assert.ok(
    !(r.stderr as string).includes("ERROR: seed-dev refuses"),
    `guard should not fire when DEV_SEED_FORCE=true.\nstderr: ${r.stderr}`,
  );
});

// ── seed-dev-extra-obs.ts ──────────────────────────────────────────────────

test("seed-dev-extra-obs: remote DATABASE_URL → exits 1 with guard error", () => {
  const r = runSeed("seed-dev-extra-obs.ts", {
    DATABASE_URL: REMOTE_URL,
    NODE_ENV:     "development",
    DEV_SEED_FORCE: "",
  });
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status}`);
  assert.ok(
    (r.stderr as string).includes("ERROR: seed-dev-extra-obs refuses"),
    `expected guard error in stderr.\nstderr: ${r.stderr}`,
  );
});

test("seed-dev-extra-obs: NODE_ENV=production with local URL → exits 1 with guard error", () => {
  const r = runSeed("seed-dev-extra-obs.ts", {
    DATABASE_URL: LOCAL_URL,
    NODE_ENV:     "production",
    DEV_SEED_FORCE: "",
  });
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status}`);
  assert.ok(
    (r.stderr as string).includes("ERROR: seed-dev-extra-obs refuses"),
    `expected guard error in stderr.\nstderr: ${r.stderr}`,
  );
});

test("seed-dev-extra-obs: DEV_SEED_FORCE=true bypasses remote-URL guard", () => {
  const r = runSeed("seed-dev-extra-obs.ts", {
    DATABASE_URL:   REMOTE_URL,
    NODE_ENV:       "development",
    DEV_SEED_FORCE: "true",
  });
  assert.ok(
    !(r.stderr as string).includes("ERROR: seed-dev-extra-obs refuses"),
    `guard should not fire when DEV_SEED_FORCE=true.\nstderr: ${r.stderr}`,
  );
});
