#!/usr/bin/env node
/**
 * source-fingerprint.mjs — a stable hash of the TypeScript sources that get
 * bundled into the API server.
 *
 * Why this exists
 * ───────────────
 * `pnpm --filter @workspace/api-server run dev` is `build && start`: the server
 * that ends up listening on 8080 is a COMPILED SNAPSHOT of the source tree at
 * the moment it was started. It never picks up a later edit, and nothing about
 * a running server says which snapshot it is.
 *
 * scripts/wait-for-api.sh reuses whatever already answers on the port, which is
 * the right call for speed and the wrong one after a pull: tsx loads the new
 * test files and points them at a server built from the old code. That produced
 * two rounds of confusing failures in one night — assertions failing against a
 * server that predated the change they were testing — and once a browser crash
 * when the UI outran the API.
 *
 * So the build stamps this fingerprint into the bundle, the server reports it,
 * and the test script compares it against a freshly computed one. Same function
 * on both sides, called from one file, because two implementations of a hash
 * drift and a silently-drifted staleness check is worse than none.
 *
 * What is covered, and what is deliberately not
 * ────────────────────────────────────────────
 * Every .ts file under artifacts/api-server/src and lib/<pkg>/src — the working
 * tree, not HEAD, so an uncommitted edit counts. That matters: the common case
 * is editing a file and re-running tests without restarting, where HEAD has not
 * moved at all and a commit-based check would see nothing wrong.
 *
 * Excluded: test files, which tsx runs directly and which are never bundled.
 * Including them would rebuild the server every time a test was edited.
 *
 * Not covered: package.json and the lockfile. A dependency bump changes the
 * bundle without changing this hash. It is rare inside a test loop, and the
 * alternative is a check that fires on every install.
 *
 * Usage:
 *   node scripts/source-fingerprint.mjs     # prints the hash
 *   import { sourceFingerprint } from "./source-fingerprint.mjs"
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Run by tsx, never bundled — see the note above. */
const IS_TEST_FILE = /(?:^|[\\/])test-[^\\/]*\.ts$|\.test\.tsx?$/;

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !IS_TEST_FILE.test(full)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Source directories that feed the bundle: the server itself, plus every
 * workspace library. Discovered rather than listed, so a library added later
 * is covered without anyone remembering to come back here.
 */
function sourceRoots(repoRoot) {
  const roots = [path.join(repoRoot, "artifacts/api-server/src")];
  const libDir = path.join(repoRoot, "lib");
  if (existsSync(libDir)) {
    for (const entry of readdirSync(libDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = path.join(libDir, entry.name, "src");
      if (existsSync(src)) roots.push(src);
    }
  }
  return roots.filter((r) => existsSync(r));
}

/**
 * A 16-hex-char digest over the path and contents of every covered file.
 *
 * Paths are included and normalised to forward slashes so that a rename is a
 * change, and so the hash is identical on macOS and on Replit's Linux.
 */
export function sourceFingerprint(repoRoot = REPO_ROOT) {
  const files = [];
  for (const root of sourceRoots(repoRoot)) walk(root, files);
  files.sort();

  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(path.relative(repoRoot, file).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/* Printed for the shell script, which has no other way to call a JS function. */
if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(sourceFingerprint() + "\n");
}
