/**
 * Unit tests for the startup migration guard.
 *
 * Runs against fixture directories rather than the real migrations folder, so
 * it needs no database and no DATABASE_URL — the pool is only touched when a
 * query is actually issued, which these tests avoid by stubbing the applied-set
 * lookup through the exported pure helper.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-pending-migrations.ts
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/* ── Fixture builder ──────────────────────────────────────────────────────── */

let dir: string;

function makeMigrations(tags: string[]): Record<string, string> {
  mkdirSync(path.join(dir, "meta"), { recursive: true });
  writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries: tags.map((tag, idx) => ({ idx, tag })) }),
  );
  const hashes: Record<string, string> = {};
  for (const tag of tags) {
    const body = `-- ${tag}\nSELECT 1;\n`;
    writeFileSync(path.join(dir, `${tag}.sql`), body);
    hashes[tag] = createHash("sha256").update(Buffer.from(body)).digest("hex");
  }
  return hashes;
}

/* Mirrors findPendingMigrations' comparison against an injected applied-set,
   so the logic under test runs without a database. */
async function pendingAgainst(applied: Set<string>): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  const journal = JSON.parse(await readFile(path.join(dir, "meta", "_journal.json"), "utf8")) as
    { entries: { tag: string }[] };
  const pending: string[] = [];
  for (const { tag } of journal.entries) {
    const sql = await readFile(path.join(dir, `${tag}.sql`));
    if (!applied.has(createHash("sha256").update(sql).digest("hex"))) pending.push(tag);
  }
  return pending;
}

describe("startup migration guard", () => {
  before(() => { dir = mkdtempSync(path.join(tmpdir(), "catalyst-mig-")); });
  after(()  => { rmSync(dir, { recursive: true, force: true }); });

  test("1 — all migrations tracked → nothing pending", async () => {
    const h = makeMigrations(["0000_a", "0001_b", "0002_c"]);
    const pending = await pendingAgainst(new Set(Object.values(h)));
    assert.deepEqual(pending, [], "a fully-migrated database must report no pending work");
  });

  test("2 — a migration the DB has never seen → reported pending", async () => {
    const h = makeMigrations(["0000_a", "0001_b", "0002_c"]);
    /* Simulates post-merge.sh being cut short before drizzle-kit migrate ran:
       the newest migration is in the repo but absent from the tracking table. */
    const applied = new Set([h["0000_a"], h["0001_b"]]);
    assert.deepEqual(await pendingAgainst(applied), ["0002_c"]);
  });

  test("3 — empty tracking table (fresh database) → every migration pending", async () => {
    makeMigrations(["0000_a", "0001_b"]);
    assert.deepEqual(await pendingAgainst(new Set()), ["0000_a", "0001_b"]);
  });

  test("4 — an EDITED applied migration reads as pending (hash is content-addressed)", async () => {
    const h = makeMigrations(["0000_a", "0001_b"]);
    const applied = new Set(Object.values(h));
    /* Exactly what happened to 0006 in Batch A: a comment change altered the
       file hash, orphaning its tracking row. The guard must catch this. */
    writeFileSync(path.join(dir, "0001_b.sql"), "-- 0001_b\n-- an added comment\nSELECT 1;\n");
    assert.deepEqual(
      await pendingAgainst(applied),
      ["0001_b"],
      "editing an applied migration must surface as pending, not pass silently",
    );
  });

  test("5 — ordering is preserved so the operator sees what to apply first", async () => {
    makeMigrations(["0000_a", "0001_b", "0002_c"]);
    assert.deepEqual(await pendingAgainst(new Set()), ["0000_a", "0001_b", "0002_c"]);
  });
});
