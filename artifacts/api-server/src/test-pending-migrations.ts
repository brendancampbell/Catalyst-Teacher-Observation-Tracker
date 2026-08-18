/**
 * Unit tests for the startup migration guard.
 *
 * These exercise the real exported functions — classifyMigrations for the
 * decision logic and readJournal for the file hashing — rather than a
 * reimplementation of them. An earlier version of this file mirrored the logic
 * locally, which meant the tests could pass while the shipped code was wrong.
 *
 * No database required: classifyMigrations is pure, and readJournal reads a
 * fixture directory.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:pending-migrations
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyMigrations, readJournal, type JournalMigration } from "./lib/pending-migrations.js";

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const entry = (tag: string, when: number, hash = `hash-${tag}`): JournalMigration => ({ tag, when, hash });

let dir: string;

function writeFixture(specs: { tag: string; when: number; body?: string }[]): void {
  mkdirSync(path.join(dir, "meta"), { recursive: true });
  writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql",
      entries: specs.map((s, idx) => ({ idx, tag: s.tag, when: s.when })) }),
  );
  for (const s of specs) writeFileSync(path.join(dir, `${s.tag}.sql`), s.body ?? `-- ${s.tag}\nSELECT 1;\n`);
}

/* ── Decision logic ───────────────────────────────────────────────────────── */

describe("startup migration guard — classification", () => {
  test("1 — every hash tracked → nothing pending, nothing divergent", () => {
    const entries = [entry("0000_a", 100), entry("0001_b", 200)];
    const r = classifyMigrations(entries, new Set(["hash-0000_a", "hash-0001_b"]), 200);
    assert.deepEqual(r.pending, []);
    assert.deepEqual(r.divergent, []);
    assert.equal(r.checked, 2);
  });

  test("2 — untracked and NEWER than the last applied → pending (migrate will apply)", () => {
    /* The real 0009 case: post-merge never ran, migrate would fix it. */
    const entries = [entry("0000_a", 100), entry("0009_new", 900)];
    const r = classifyMigrations(entries, new Set(["hash-0000_a"]), 100);
    assert.deepEqual(r.pending, ["0009_new"], "must block startup — there is a working remedy");
    assert.deepEqual(r.divergent, []);
  });

  test("3 — untracked but OLDER than the last applied → divergent, NOT pending", () => {
    /* The 0006 case: an applied migration file was edited, so its hash no
       longer matches. drizzle-kit migrate skips it on timestamp, so blocking
       startup would deadlock — the guard would demand something the documented
       remedy cannot deliver. */
    const entries = [entry("0006_edited", 150), entry("0008_c", 800)];
    const r = classifyMigrations(entries, new Set(["hash-0008_c"]), 800);
    assert.deepEqual(r.pending, [], "must NOT block — migrate cannot resolve this");
    assert.deepEqual(r.divergent, ["0006_edited"], "must still be reported");
  });

  test("4 — empty tracking table → everything pending, nothing divergent", () => {
    const entries = [entry("0000_a", 100), entry("0001_b", 200)];
    const r = classifyMigrations(entries, new Set(), null);
    assert.deepEqual(r.pending, ["0000_a", "0001_b"], "a fresh DB applies all of them");
    assert.deepEqual(r.divergent, []);
  });

  test("5 — mixed: one genuinely pending and one edited old file", () => {
    const entries = [entry("0006_edited", 150), entry("0008_c", 800), entry("0009_new", 900)];
    const r = classifyMigrations(entries, new Set(["hash-0008_c"]), 800);
    assert.deepEqual(r.pending, ["0009_new"]);
    assert.deepEqual(r.divergent, ["0006_edited"]);
  });

  test("6 — pending order follows the journal, so the operator sees what applies first", () => {
    const entries = [entry("0000_a", 100), entry("0001_b", 200), entry("0002_c", 300)];
    assert.deepEqual(classifyMigrations(entries, new Set(), null).pending, ["0000_a", "0001_b", "0002_c"]);
  });
});

/* ── File hashing ─────────────────────────────────────────────────────────── */

describe("startup migration guard — journal reading", () => {
  before(() => { dir = mkdtempSync(path.join(tmpdir(), "catalyst-mig-")); });
  after(()  => { rmSync(dir, { recursive: true, force: true }); });

  test("7 — hashes are the SHA256 of file contents, and `when` is carried through", async () => {
    writeFixture([{ tag: "0000_a", when: 111 }, { tag: "0001_b", when: 222 }]);
    const entries = await readJournal(dir);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.when, 111);
    assert.equal(
      entries[0]!.hash,
      createHash("sha256").update(Buffer.from("-- 0000_a\nSELECT 1;\n")).digest("hex"),
      "must match drizzle's content hash exactly, or tracked migrations look unapplied",
    );
  });

  test("8 — editing a file changes its hash (why applied migrations are immutable)", async () => {
    writeFixture([{ tag: "0000_a", when: 111 }]);
    const before = (await readJournal(dir))[0]!.hash;
    writeFixture([{ tag: "0000_a", when: 111, body: "-- 0000_a\n-- an added comment\nSELECT 1;\n" }]);
    const after = (await readJournal(dir))[0]!.hash;
    assert.notEqual(before, after, "a comment-only edit must still change the hash");
  });
});
