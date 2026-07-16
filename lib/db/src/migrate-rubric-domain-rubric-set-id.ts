/**
 * Migration: add and backfill rubric_domains.rubric_set_id
 *
 * Applies in three safe phases:
 *   1. Add column as nullable (idempotent — skipped if column already exists)
 *   2. Backfill from rubric_categories.rubric_set_id via JOIN
 *   3. Apply NOT NULL constraint + unique index on (rubric_set_id, slug)
 *      (drizzle-kit push --force handles the index; this script handles the data)
 *
 * Run with:
 *   pnpm --filter @workspace/db tsx src/migrate-rubric-domain-rubric-set-id.ts
 *
 * Safe to run multiple times — each phase checks for its own precondition.
 */

import { pool } from "./index.js";

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    /* ── Phase 1: add column if not present ─────────────────────── */
    const { rows: cols } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'rubric_domains'
        AND column_name = 'rubric_set_id'
    `);
    if (cols.length === 0) {
      console.log("Phase 1: adding rubric_domains.rubric_set_id (nullable)…");
      await client.query(`
        ALTER TABLE rubric_domains
          ADD COLUMN rubric_set_id integer
            REFERENCES rubric_sets(id) ON DELETE CASCADE
      `);
    } else {
      console.log("Phase 1: column already exists — skipped.");
    }

    /* ── Phase 2: backfill NULL rows from category join ─────────── */
    const { rowCount } = await client.query(`
      UPDATE rubric_domains d
      SET rubric_set_id = c.rubric_set_id
      FROM rubric_categories c
      WHERE d.category_id = c.id
        AND d.rubric_set_id IS NULL
    `);
    console.log(`Phase 2: backfilled ${rowCount ?? 0} rows.`);

    /* ── Phase 3: verify no NULLs remain before NOT NULL constraint ─ */
    const { rows: nullRows } = await client.query(`
      SELECT COUNT(*) AS cnt FROM rubric_domains WHERE rubric_set_id IS NULL
    `);
    const remaining = Number(nullRows[0]?.cnt ?? 0);
    if (remaining > 0) {
      throw new Error(
        `${remaining} rubric_domains rows still have rubric_set_id = NULL after backfill. ` +
        "Fix orphaned rows before applying the NOT NULL constraint."
      );
    }

    await client.query("COMMIT");
    console.log("Migration complete. Run `pnpm --filter @workspace/db push-force` to apply NOT NULL + unique index.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error("Migration failed:", err); process.exit(1); });
