/**
 * Backfill: set school_year_id on any NULL rows in rubric_sets, rubric_domains,
 * observations, and action_steps.
 *
 * Strategy:
 *   - rubric_sets / rubric_domains: use the school year named "2025-2026"
 *     (these were the rows created before school-year tracking existed).
 *   - observations / action_steps: first try to derive the year from the
 *     rubric_set already joined to the observation; if still NULL, fall back
 *     to the active school year (status = 'active').
 *
 * Safe to run multiple times — every UPDATE filters on IS NULL so it becomes
 * a no-op once all rows are backfilled.
 *
 * Run with:
 *   pnpm --filter @workspace/db tsx src/backfill-school-year-id.ts
 */

import { pool } from "./index.js";

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    /* ── 1. Resolve the "2025-2026" school year id ───────────────── */
    const { rows: yearRows } = await client.query<{ id: number }>(`
      SELECT id FROM school_years WHERE name = '2025-2026' LIMIT 1
    `);
    if (yearRows.length === 0) {
      throw new Error(
        "Cannot backfill: no school_year row named '2025-2026' found. " +
        "Create it first or adjust the target name in this script."
      );
    }
    const year2526Id = yearRows[0].id;
    console.log(`Using school_year id=${year2526Id} ("2025-2026") for rubric rows.`);

    /* ── 2. Resolve the active school year id (for obs / steps) ──── */
    const { rows: activeYearRows } = await client.query<{ id: number }>(`
      SELECT id FROM school_years WHERE status = 'active' ORDER BY display_order DESC LIMIT 1
    `);
    const activeYearId: number = activeYearRows.length > 0
      ? activeYearRows[0].id
      : year2526Id;
    console.log(`Using school_year id=${activeYearId} (active) as fallback for observations/action_steps.`);

    /* ── 3. Backfill rubric_sets ─────────────────────────────────── */
    const { rowCount: rsCount } = await client.query(`
      UPDATE rubric_sets
      SET school_year_id = $1
      WHERE school_year_id IS NULL
    `, [year2526Id]);
    console.log(`rubric_sets:    backfilled ${rsCount ?? 0} rows.`);

    /* ── 4. Backfill rubric_domains ──────────────────────────────── */
    const { rowCount: rdCount } = await client.query(`
      UPDATE rubric_domains
      SET school_year_id = $1
      WHERE school_year_id IS NULL
    `, [year2526Id]);
    console.log(`rubric_domains: backfilled ${rdCount ?? 0} rows.`);

    /* ── 5. Backfill observations ────────────────────────────────── */
    /*    First pass: derive year from the joined rubric_set (preferred). */
    const { rowCount: obsCount1 } = await client.query(`
      UPDATE observations o
      SET school_year_id = rs.school_year_id
      FROM rubric_sets rs
      WHERE o.rubric_set_id = rs.id
        AND o.school_year_id IS NULL
        AND rs.school_year_id IS NOT NULL
    `);
    console.log(`observations:   backfilled ${obsCount1 ?? 0} rows via rubric_set join.`);

    /*    Second pass: anything still NULL gets the active year. */
    const { rowCount: obsCount2 } = await client.query(`
      UPDATE observations
      SET school_year_id = $1
      WHERE school_year_id IS NULL
    `, [activeYearId]);
    console.log(`observations:   backfilled ${obsCount2 ?? 0} additional rows via active year.`);

    /* ── 6. Backfill action_steps ────────────────────────────────── */
    /*    First pass: derive year from the linked observation. */
    const { rowCount: asCount1 } = await client.query(`
      UPDATE action_steps a
      SET school_year_id = o.school_year_id
      FROM observations o
      WHERE a.assigned_during_observation_id = o.id
        AND a.school_year_id IS NULL
        AND o.school_year_id IS NOT NULL
    `);
    console.log(`action_steps:   backfilled ${asCount1 ?? 0} rows via observation join.`);

    /*    Second pass: anything still NULL gets the active year. */
    const { rowCount: asCount2 } = await client.query(`
      UPDATE action_steps
      SET school_year_id = $1
      WHERE school_year_id IS NULL
    `, [activeYearId]);
    console.log(`action_steps:   backfilled ${asCount2 ?? 0} additional rows via active year.`);

    /* ── 7. Verify no NULLs remain ───────────────────────────────── */
    const tables = ["rubric_sets", "rubric_domains", "observations", "action_steps"] as const;
    let allClean = true;
    for (const tbl of tables) {
      const { rows } = await client.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM ${tbl} WHERE school_year_id IS NULL`
      );
      const remaining = Number(rows[0]?.cnt ?? 0);
      if (remaining > 0) {
        console.error(`ERROR: ${tbl} still has ${remaining} NULL school_year_id rows.`);
        allClean = false;
      }
    }

    if (!allClean) {
      throw new Error("Backfill incomplete — see errors above.");
    }

    await client.query("COMMIT");
    console.log("Backfill complete. All school_year_id columns are non-NULL.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error("Backfill failed:", err); process.exit(1); });
