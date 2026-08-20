/**
 * Unit tests for the API server's source fingerprint.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-source-fingerprint.ts
 *
 * No database and no server — the fingerprint is a pure function of a file
 * tree, so the tests build throwaway trees rather than hashing the real repo.
 * Asserting against the real repo would make these tests fail on every commit.
 *
 * What is being protected: scripts/wait-for-api.sh refuses to run integration
 * tests when the running server's fingerprint differs from the sources'. Two
 * ways that guard could rot silently —
 *
 *   - too loose: it stops noticing a real change, and stale servers come back
 *   - too tight: it fires on files that never reach the bundle (test files
 *     most of all), and everyone learns to set WAIT_FOR_API_ALLOW_STALE=1
 *
 * The second is the more dangerous one, because it disables the check for good.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sourceFingerprint } from "../../../scripts/source-fingerprint.mjs";

/** Build a fake repo. Keys are repo-relative paths, values file contents. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "fp-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const BASE: Record<string, string> = {
  "artifacts/api-server/src/index.ts":        "export const a = 1;\n",
  "artifacts/api-server/src/routes/health.ts": "export const b = 2;\n",
  "lib/db/src/schema.ts":                     "export const c = 3;\n",
};

describe("sourceFingerprint", () => {
  test("is deterministic", () => {
    const root = fixture(BASE);
    try {
      assert.equal(sourceFingerprint(root), sourceFingerprint(root));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("depends on contents, not on where the tree lives", () => {
    /* Paths are hashed relative to the repo root, so the same sources check
       out to the same fingerprint on a laptop and on Replit. Without this the
       comparison would be useless anywhere but the machine that built it. */
    const a = fixture(BASE);
    const b = fixture(BASE);
    try {
      assert.equal(sourceFingerprint(a), sourceFingerprint(b));
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  test("changes when a bundled source changes", () => {
    const root = fixture(BASE);
    try {
      const before = sourceFingerprint(root);
      writeFileSync(path.join(root, "artifacts/api-server/src/routes/health.ts"), "export const b = 99;\n");
      assert.notEqual(sourceFingerprint(root), before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("changes when a workspace library changes", () => {
    /* lib/db is bundled into the server, so drift there is drift in the
       running server even though nothing under api-server/src moved. */
    const root = fixture(BASE);
    try {
      const before = sourceFingerprint(root);
      writeFileSync(path.join(root, "lib/db/src/schema.ts"), "export const c = 4;\n");
      assert.notEqual(sourceFingerprint(root), before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("picks up a library added later", () => {
    /* Roots are discovered, not listed, so a new lib/<pkg>/src is covered
       without anyone remembering to update the fingerprint script. */
    const root = fixture(BASE);
    try {
      const before = sourceFingerprint(root);
      mkdirSync(path.join(root, "lib/brand-new/src"), { recursive: true });
      writeFileSync(path.join(root, "lib/brand-new/src/thing.ts"), "export const d = 5;\n");
      assert.notEqual(sourceFingerprint(root), before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("treats a rename as a change", () => {
    const root = fixture(BASE);
    try {
      const before = sourceFingerprint(root);
      renameSync(
        path.join(root, "artifacts/api-server/src/routes/health.ts"),
        path.join(root, "artifacts/api-server/src/routes/healthz.ts"),
      );
      assert.notEqual(sourceFingerprint(root), before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("ignores test files", () => {
    /* The critical exclusion. tsx runs these directly and they are never
       bundled; counting them would demand a server restart after every test
       edit, which is the fastest possible way to get the check switched off. */
    const root = fixture(BASE);
    try {
      const before = sourceFingerprint(root);
      writeFileSync(path.join(root, "artifacts/api-server/src/test-thing.ts"), "// a test\n");
      writeFileSync(path.join(root, "lib/db/src/schema.test.ts"), "// also a test\n");
      assert.equal(sourceFingerprint(root), before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("ignores node_modules, dist and non-TypeScript files", () => {
    const root = fixture(BASE);
    try {
      const before = sourceFingerprint(root);
      mkdirSync(path.join(root, "artifacts/api-server/src/node_modules"), { recursive: true });
      writeFileSync(path.join(root, "artifacts/api-server/src/node_modules/dep.ts"), "export const e = 6;\n");
      mkdirSync(path.join(root, "lib/db/src/dist"), { recursive: true });
      writeFileSync(path.join(root, "lib/db/src/dist/schema.ts"), "export const f = 7;\n");
      writeFileSync(path.join(root, "artifacts/api-server/src/notes.md"), "not code\n");
      assert.equal(sourceFingerprint(root), before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
