/**
 * Backfill: give every active person an open assignment in the active school
 * year, so the assignments ledger actually describes who works here.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The school-year rollover decides who has left by asking: "who holds an open
 * assignment in the outgoing year and none in the incoming one?" That question
 * is only meaningful if the outgoing year's ledger is complete.
 *
 * It was not. Assignment rows are only ever written by four code paths — the
 * roster upload, POST /people, the bulk upsert, and reassign — so everyone who
 * predates those, or who arrived by seeding or direct insert, has no assignment
 * row at all. Measured 2026-08-18: 2115 active people, 2 with an open
 * assignment in the active year. Removing someone from a roster file therefore
 * did nothing to 99.9% of staff, silently.
 *
 * backfill-school-year-id.ts does NOT cover this. It sets school_year_id on
 * rows that already exist; it never creates a row for a person who has none.
 *
 * ── What it changes ───────────────────────────────────────────────────────
 * This is not a cosmetic repair. checkActiveThisYear() currently waves through
 * anyone with no assignment history at all ("not yet scoped, do not block").
 * After this runs they all have history, so they are gated on their assignment
 * being correct — and omitting someone from a future roster file stops being
 * harmless and starts deactivating them. That is the intended behaviour, but it
 * means this must be run while the current year is active and verified
 * immediately, not in the middle of a year switch.
 *
 * ── Deliberate exclusions ─────────────────────────────────────────────────
 * NETWORK_ADMIN. Admins are active in every school year and are not rostered
 * (see checkActiveThisYear), so giving them assignment rows would contradict
 * that and inflate every school's headcount in the roster diff.
 *
 * Inactive people. If is_active is false they are already offboarded; adding a
 * live assignment row would misrepresent them as current staff.
 *
 * ── Running it ────────────────────────────────────────────────────────────
 *   pnpm --filter @workspace/db exec tsx src/backfill-assignments.ts
 *   pnpm --filter @workspace/db exec tsx src/backfill-assignments.ts --apply
 *
 * Dry run by default: prints what it would write and changes nothing.
 * Idempotent — anyone who already holds an open assignment in the target year
 * is skipped, so a second run is a no-op.
 *
 * NOT wired into post-merge.sh. This is a one-time correction of historical
 * data, not a recurring invariant, and it should be run deliberately with
 * someone reading the output.
 */

import { pool } from "./index.js";

interface Candidate {
  employee_id: string;
  first_name:  string;
  last_name:   string;
  role:        string;
  school_id:   number | null;
  school_name: string | null;
}

async function run(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const client = await pool.connect();

  try {
    /* ── Resolve the active school year ──────────────────────────── */
    const { rows: yearRows } = await client.query<{ id: number; name: string; start_date: string | null }>(`
      SELECT id, name, start_date FROM school_years WHERE status = 'active' LIMIT 1
    `);
    if (yearRows.length === 0) {
      throw new Error("No active school year. Activate one before backfilling assignments.");
    }
    const year = yearRows[0]!;
    console.log(`Target school year: ${year.name} (id=${year.id})\n`);

    /* Date the assignment from the year's start when known, so the ledger
       reads as "employed for this year" rather than "hired today". */
    const startDate = year.start_date ?? new Date().toISOString().slice(0, 10);

    /* ── Who needs a row ─────────────────────────────────────────── */
    const { rows: candidates } = await client.query<Candidate>(`
      SELECT p.employee_id, p.first_name, p.last_name, p.role, p.school_id,
             s.display_name AS school_name
        FROM people p
        LEFT JOIN schools s ON s.id = p.school_id
       WHERE p.is_active = true
         AND p.role <> 'NETWORK_ADMIN'
         AND NOT EXISTS (
               SELECT 1 FROM assignments a
                WHERE a.user_id = p.employee_id
                  AND a.school_year_id = $1
                  AND a.end_date IS NULL)
       ORDER BY s.display_name NULLS FIRST, p.last_name, p.first_name
    `, [year.id]);

    if (candidates.length === 0) {
      console.log("Nothing to do — every active non-admin already holds an open assignment in this year.");
      return;
    }

    /* ── Report before writing ───────────────────────────────────── */
    const bySchool = new Map<string, number>();
    const byRole   = new Map<string, number>();
    const unplaced: Candidate[] = [];

    for (const c of candidates) {
      const school = c.school_name ?? "(no school)";
      bySchool.set(school, (bySchool.get(school) ?? 0) + 1);
      byRole.set(c.role, (byRole.get(c.role) ?? 0) + 1);
      if (c.school_id === null) unplaced.push(c);
    }

    console.log(`${candidates.length} active people have no open assignment in ${year.name}.\n`);

    console.log("By school:");
    for (const [school, n] of [...bySchool.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${school}`);
    }

    console.log("\nBy role:");
    for (const [role, n] of [...byRole.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${role}`);
    }

    if (unplaced.length > 0) {
      /*
       * assignments.school_id is nullable, so these will be written — but an
       * assignment with no school is invisible to every school-scoped view and
       * unattributable in the roster diff. Worth seeing before, not after.
       */
      console.log(`\n⚠️  ${unplaced.length} have no school on their person record.`);
      console.log("   Their assignment will also have no school, which makes them");
      console.log("   unattributable in the roster diff. Consider fixing these first:");
      for (const c of unplaced.slice(0, 20)) {
        console.log(`     ${c.employee_id}  ${c.first_name} ${c.last_name}  (${c.role})`);
      }
      if (unplaced.length > 20) console.log(`     …and ${unplaced.length - 20} more`);
    }

    if (!apply) {
      console.log("\n── DRY RUN — nothing was written ──");
      console.log("Re-run with --apply to write these assignments.");
      return;
    }

    /* ── Write ───────────────────────────────────────────────────── */
    await client.query("BEGIN");

    const { rowCount } = await client.query(`
      INSERT INTO assignments (user_id, role, school_id, school_year_id, start_date, end_date)
      SELECT p.employee_id, p.role, p.school_id, $1, $2::date, NULL
        FROM people p
       WHERE p.is_active = true
         AND p.role <> 'NETWORK_ADMIN'
         AND NOT EXISTS (
               SELECT 1 FROM assignments a
                WHERE a.user_id = p.employee_id
                  AND a.school_year_id = $1
                  AND a.end_date IS NULL)
      ON CONFLICT DO NOTHING
    `, [year.id, startDate]);

    /* ── Verify inside the transaction, roll back if it did not take ── */
    const { rows: [check] } = await client.query<{ remaining: string }>(`
      SELECT count(*)::text AS remaining
        FROM people p
       WHERE p.is_active = true
         AND p.role <> 'NETWORK_ADMIN'
         AND NOT EXISTS (
               SELECT 1 FROM assignments a
                WHERE a.user_id = p.employee_id
                  AND a.school_year_id = $1
                  AND a.end_date IS NULL)
    `, [year.id]);

    if (Number(check!.remaining) !== 0) {
      await client.query("ROLLBACK");
      throw new Error(
        `Backfill incomplete: ${check!.remaining} active people still have no open ` +
        `assignment in ${year.name}. Rolled back — nothing was written.`,
      );
    }

    await client.query("COMMIT");
    console.log(`\nWrote ${rowCount ?? 0} assignments. Every active non-admin now holds one in ${year.name}.`);
    console.log("\nNext: confirm a few people can still sign in. From here on, omitting");
    console.log("someone from a roster file will deactivate them at the next rollover.");
  } finally {
    client.release();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error("Backfill failed:", err); process.exit(1); });
