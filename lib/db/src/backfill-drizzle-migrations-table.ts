/**
 * Backfill: populate drizzle.__drizzle_migrations for migrations that were
 * applied via `drizzle-kit push` (which never writes to the tracking table).
 *
 * Background: migrations 0000–0007 were applied via `drizzle-kit push-force`,
 * which never writes to the tracking table. As a result, `drizzle-kit migrate`
 * always tries to re-apply every migration and fails with PG error 42710
 * ("type already exists").
 *
 * IMPORTANT — explicit allowlist design:
 * This script only marks a fixed, explicitly approved set of migration tags
 * as applied. It does NOT read all journal entries blindly.  Any migration
 * added after this script was written will NOT be pre-marked — it will be
 * applied normally by `drizzle-kit migrate`.
 *
 * Safe to re-run: uses WHERE NOT EXISTS so rows are only inserted once.
 *
 * Run with:
 *   pnpm --filter @workspace/db exec tsx src/backfill-drizzle-migrations-table.ts
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

/**
 * The set of migration tags that were applied via push (not migrate) and
 * therefore need to be backfilled into the tracking table.
 *
 * DO NOT add new entries to this list. Any migration created after this
 * baseline should be applied normally via `drizzle-kit migrate`.
 */
const APPLIED_BASELINE: Array<{ tag: string; when: number }> = [
  { tag: "0000_absent_gabe_jones",                          when: 1784486543556 },
  { tag: "0001_add_school_years_and_assignments",            when: 1784700000000 },
  { tag: "0002_rubric_sets_school_year",                     when: 1784800000000 },
  { tag: "0003_observations_action_steps_school_year",       when: 1784900000000 },
  { tag: "0004_school_years_display_order",                  when: 1785000000000 },
  { tag: "0005_schema_hardening",                            when: 1753000000000 },
  { tag: "0006_school_number_not_null",                      when: 1753056000000 },
  // 0007 was produced by `drizzle-kit generate` after push history was lost;
  // its two DDL statements (drop unique constraint, alter column type) were
  // already applied via push-force before this script existed.
  { tag: "0007_boring_ravenous",                             when: 1784730433963 },
];

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    /* ── 1. Ensure the drizzle schema and tracking table exist ── */
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id         SERIAL PRIMARY KEY,
        hash       TEXT   NOT NULL,
        created_at BIGINT
      )
    `);
    console.log("drizzle.__drizzle_migrations table ready.");

    /* ── 2. Insert one row per known-applied migration ── */
    let inserted = 0;
    let skipped = 0;

    for (const entry of APPLIED_BASELINE) {
      const sqlFile = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
      if (!fs.existsSync(sqlFile)) {
        throw new Error(`Migration file not found: ${sqlFile}`);
      }

      const fileBytes = fs.readFileSync(sqlFile);
      const hash = crypto.createHash("sha256").update(fileBytes).digest("hex");

      const result = await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
         SELECT $1, $2
         WHERE NOT EXISTS (
           SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1
         )`,
        [hash, entry.when]
      );

      if ((result.rowCount ?? 0) > 0) {
        console.log(`  inserted  ${entry.tag}  (hash=${hash.slice(0, 16)}...)`);
        inserted++;
      } else {
        console.log(`  skipped   ${entry.tag}  (already present)`);
        skipped++;
      }
    }

    console.log(`\nDone: ${inserted} inserted, ${skipped} already present.`);
  } finally {
    client.release();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill-drizzle-migrations-table failed:", err);
    process.exit(1);
  });
