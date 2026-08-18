/**
 * Startup guard: refuse to boot when the code carries migrations the database
 * has not applied.
 *
 * Migrations are applied by scripts/post-merge.sh, wired to the [postMerge]
 * hook in .replit — on merge, not on deploy or boot. That hook has a timeout
 * (35s at time of writing, measured at ~28s on a warm cache). If it overruns,
 * it is cut short and `drizzle-kit migrate` may never run — leaving the repo
 * with a migration the database lacks, and no signal that anything is wrong.
 *
 * Since the running code then expects columns or tables that do not exist,
 * the correct response is to refuse to start rather than serve errors.
 *
 * Detection mirrors drizzle-kit: a migration is "applied" when the SHA256 of
 * its .sql file appears in drizzle.__drizzle_migrations. Note this means
 * editing an applied migration file makes it look unapplied — see
 * lib/db/README.md, "Never edit an applied migration file".
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
 * A fixed relative path does NOT work here: esbuild inlines this file into
 * dist/index.mjs, which sits one directory shallower than src/lib/, so the same
 * "../../.." resolves to two different places depending on whether the server
 * is running from source (tsx) or from the bundle. Searching upward for the
 * directory is correct in both, and stays correct if the layout changes.
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
    fileURLToPath(import.meta.url) +
    ". Set MIGRATIONS_DIR to override.",
  );
}

interface JournalEntry { tag: string }

export interface PendingMigrationsResult {
  pending: string[];
  checked: number;
}

/**
 * Returns the tags of migrations present in the journal but absent from the
 * database's tracking table.
 */
export async function findPendingMigrations(
  migrationsDir: string = resolveMigrationsDir(),
): Promise<PendingMigrationsResult> {
  const journalRaw = await readFile(path.join(migrationsDir, "meta", "_journal.json"), "utf8");
  const entries = (JSON.parse(journalRaw) as { entries: JournalEntry[] }).entries;

  let applied: Set<string>;
  try {
    const { rows } = await pool.query<{ hash: string }>(
      "SELECT hash FROM drizzle.__drizzle_migrations",
    );
    applied = new Set(rows.map((r) => r.hash));
  } catch (err) {
    /* No tracking table yet — a database that has never been migrated.
       Every journal entry is pending. */
    if ((err as { code?: string }).code === "42P01") applied = new Set();
    else throw err;
  }

  const pending: string[] = [];
  for (const { tag } of entries) {
    const sql = await readFile(path.join(migrationsDir, `${tag}.sql`));
    const hash = createHash("sha256").update(sql).digest("hex");
    if (!applied.has(hash)) pending.push(tag);
  }

  return { pending, checked: entries.length };
}

/**
 * Throws when any migration is unapplied. Called first in the startup chain,
 * whose .catch() logs and exits — so the platform surfaces a failed start
 * rather than serving against a stale schema.
 */
export async function assertMigrationsApplied(
  log: { info: (o: object, m: string) => void } = { info: () => {} },
): Promise<void> {
  const { pending, checked } = await findPendingMigrations();

  if (pending.length > 0) {
    throw new Error(
      `Database is missing ${pending.length} of ${checked} migration(s): ${pending.join(", ")}. ` +
      "Apply them with `pnpm --filter @workspace/db run migrate` (or re-run scripts/post-merge.sh), " +
      "then restart. Refusing to start against a stale schema.",
    );
  }

  log.info({ event: "migrations_verified", checked }, `All ${checked} migrations applied`);
}
