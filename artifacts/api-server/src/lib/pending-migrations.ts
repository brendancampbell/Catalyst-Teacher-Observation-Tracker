/**
 * Startup guard: refuse to boot when the database is missing migrations that
 * this build carries.
 *
 * Migrations are applied by scripts/post-merge.sh (the [postMerge] hook in
 * .replit) or by running `drizzle-kit migrate` directly. Neither is guaranteed
 * to have happened before the server starts — the hook is Replit-managed and
 * does not fire for shell-initiated pulls — so the running code can easily
 * expect columns the database does not have. Refusing to start is better than
 * serving errors from a stale schema.
 *
 * ── Why two categories ────────────────────────────────────────────────────
 * drizzle-kit decides what to apply by TIMESTAMP, not by hash:
 *
 *     if (!lastDbMigration || lastDbMigration.created_at < migration.folderMillis)
 *
 * It takes the newest applied row and runs anything with a larger folderMillis.
 * A migration whose hash is absent but whose timestamp is older will never be
 * applied by `migrate`, no matter how many times it is run.
 *
 * So an untracked migration means one of two different things:
 *
 *   PENDING    timestamp newer than the newest applied row — `migrate` will
 *              apply it. Block startup; the operator has a working remedy.
 *
 *   DIVERGENT  hash absent but timestamp older — `migrate` will NOT apply it.
 *              Usually an applied migration file that was edited, which changes
 *              its content hash (see lib/db/README.md). Blocking here would be
 *              a deadlock: the guard demands a migration that the documented
 *              remedy cannot apply. Log loudly and start.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "@workspace/db";

/*
 * Locate lib/db/migrations by walking up from this module.
 *
 * A fixed relative path does NOT work: esbuild inlines this file into
 * dist/index.mjs, one directory shallower than src/lib/, so the same "../../.."
 * resolves to two different places depending on whether the server runs from
 * source (tsx) or from the bundle.
 */
function resolveMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let hops = 0; hops < 10; hops++) {
    const candidate = path.join(dir, "lib", "db", "migrations");
    if (existsSync(path.join(candidate, "meta", "_journal.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not locate lib/db/migrations by searching upward from " +
    fileURLToPath(import.meta.url) + ". Set MIGRATIONS_DIR to override.",
  );
}

export interface JournalMigration {
  tag: string;
  /** SHA256 of the .sql file — how drizzle identifies an applied migration. */
  hash: string;
  /** The journal's `when` value, i.e. drizzle's folderMillis. */
  when: number;
}

export interface MigrationStatus {
  /** Untracked AND newer than the newest applied row — `migrate` will apply. */
  pending: string[];
  /** Untracked but older — `migrate` will never apply these. */
  divergent: string[];
  checked: number;
}

/**
 * Pure classifier, deliberately free of IO so the decision logic can be tested
 * directly rather than through a reimplementation of it.
 */
export function classifyMigrations(
  entries: JournalMigration[],
  appliedHashes: Set<string>,
  lastAppliedMillis: number | null,
): MigrationStatus {
  const pending: string[] = [];
  const divergent: string[] = [];

  for (const entry of entries) {
    if (appliedHashes.has(entry.hash)) continue;
    /* Mirrors drizzle's own condition, so the guard never demands something
       `drizzle-kit migrate` refuses to do. */
    if (lastAppliedMillis === null || entry.when > lastAppliedMillis) {
      pending.push(entry.tag);
    } else {
      divergent.push(entry.tag);
    }
  }

  return { pending, divergent, checked: entries.length };
}

/** Reads the journal and hashes each .sql file. */
export async function readJournal(migrationsDir: string): Promise<JournalMigration[]> {
  const raw = await readFile(path.join(migrationsDir, "meta", "_journal.json"), "utf8");
  const entries = (JSON.parse(raw) as { entries: { tag: string; when: number }[] }).entries;

  return Promise.all(entries.map(async ({ tag, when }) => ({
    tag,
    when,
    hash: createHash("sha256").update(await readFile(path.join(migrationsDir, `${tag}.sql`))).digest("hex"),
  })));
}

export async function checkMigrations(
  migrationsDir: string = resolveMigrationsDir(),
): Promise<MigrationStatus> {
  const entries = await readJournal(migrationsDir);

  let appliedHashes = new Set<string>();
  let lastAppliedMillis: number | null = null;

  try {
    const { rows } = await pool.query<{ hash: string; created_at: string | null }>(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations",
    );
    appliedHashes = new Set(rows.map((r) => r.hash));
    for (const r of rows) {
      const millis = r.created_at === null ? null : Number(r.created_at);
      if (millis !== null && (lastAppliedMillis === null || millis > lastAppliedMillis)) {
        lastAppliedMillis = millis;
      }
    }
  } catch (err) {
    /* No tracking table — a database that has never been migrated. Everything
       is pending, which is correct: drizzle applies all of them from scratch. */
    if ((err as { code?: string }).code !== "42P01") throw err;
  }

  return classifyMigrations(entries, appliedHashes, lastAppliedMillis);
}

interface StartupLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/**
 * Throws when migrations are genuinely pending. The startup chain's .catch()
 * logs and exits, so the platform reports a failed start rather than serving
 * against a stale schema.
 */
export async function assertMigrationsApplied(
  log: StartupLogger = { info: () => {}, error: () => {} },
): Promise<void> {
  const { pending, divergent, checked } = await checkMigrations();

  if (divergent.length > 0) {
    /* Not fatal: `drizzle-kit migrate` will not apply these, so blocking would
       leave no way forward. Almost always an applied migration file that was
       edited after the fact. */
    log.error(
      { event: "migrations_divergent", divergent },
      `${divergent.length} migration file(s) do not match their applied hash and cannot be ` +
      `applied by drizzle-kit migrate: ${divergent.join(", ")}. ` +
      "This usually means an applied migration file was edited — restore it byte-for-byte " +
      "(see lib/db/README.md). Starting anyway, because migrate cannot resolve this.",
    );
  }

  if (pending.length > 0) {
    throw new Error(
      `Database is missing ${pending.length} of ${checked} migration(s): ${pending.join(", ")}. ` +
      "Apply them with `pnpm --filter @workspace/db run migrate` (or re-run scripts/post-merge.sh), " +
      "then restart. Refusing to start against a stale schema.",
    );
  }

  log.info({ event: "migrations_verified", checked }, `All ${checked} migrations applied`);
}
