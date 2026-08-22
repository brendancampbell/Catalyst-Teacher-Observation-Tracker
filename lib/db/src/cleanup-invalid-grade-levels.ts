/**
 * Cleanup: repair grade levels that were never valid grades.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Nothing validated grades. Whatever a spreadsheet said went into the database
 * verbatim, and Excel silently rewrites cells it decides are dates: type
 * "10, 11" or "10-11" and the sheet reads "Oct 11". Reported from production
 * 2026-08-21, where a teacher of grades 10 and 11 was recorded as teaching a
 * grade called "Oct 11".
 *
 * The import now rejects or repairs these on the way in. This finds the ones
 * already stored.
 *
 * ── What it will and will not change ──────────────────────────────────────
 * Repairs only what is unambiguous. A grade is 1-12 and so is a month, so when
 * both numbers are in range the pair means the same set whichever way the date
 * was read: "Oct 11", "11 Oct" and "10/11/2026" all mean {10, 11}. There is no
 * guess left to make.
 *
 * Anything else — "Oct 25", "13", "Grade Four" — is REPORTED AND LEFT ALONE.
 * A wrong grade written silently is the problem this is cleaning up; doing it
 * again with better intentions would not be an improvement.
 *
 * ── Running it ────────────────────────────────────────────────────────────
 *   pnpm --filter @workspace/db run cleanup:grade-levels
 *   pnpm --filter @workspace/db run cleanup:grade-levels -- --apply
 *
 * Dry run by default. Writes happen in one transaction that verifies its own
 * row count before committing.
 */

import { pool } from "./index.js";

/** Pre-K, TK, K, or 1 through 12 — the same set the API enforces. */
const VALID_GRADE = /^(?:PRE-?K|PK|TK|K|[1-9]|1[0-2])$/i;

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** Undo Excel turning a pair of grades into a date, or null if unsure. */
function repairExcelDate(token: string): string[] | null {
  const raw = token.trim().toUpperCase();
  const pair = (a: number, b: number): string[] | null => {
    if (a < 1 || a > 12 || b < 1 || b > 12) return null;
    if (a === b) return [String(a)];
    return [a, b].sort((x, y) => x - y).map(String);
  };

  let m = /^([A-Z]{3,9})[\s.-]+(\d{1,2})$/.exec(raw);
  if (m) { const mo = MONTHS[m[1]!.slice(0, 3)]; return mo ? pair(mo, Number(m[2])) : null; }

  m = /^(\d{1,2})[\s.-]+([A-Z]{3,9})$/.exec(raw);
  if (m) { const mo = MONTHS[m[2]!.slice(0, 3)]; return mo ? pair(Number(m[1]), mo) : null; }

  m = /^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/.exec(raw);
  if (m) return pair(Number(m[1]), Number(m[2]));

  m = /^\d{4}-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (m) return pair(Number(m[1]), Number(m[2]));

  return null;
}

interface Row { employee_id: string; first_name: string; last_name: string; grade_level: string[] }

async function run(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const client = await pool.connect();

  try {
    const { rows } = await client.query<Row>(`
      SELECT employee_id, first_name, last_name, grade_level
        FROM people
       WHERE grade_level IS NOT NULL AND array_length(grade_level, 1) > 0
       ORDER BY last_name, first_name
    `);

    const fixable: { row: Row; next: string[]; changed: string[] }[] = [];
    const stuck:   { row: Row; bad: string[] }[] = [];

    for (const row of rows) {
      const next: string[] = [];
      const changed: string[] = [];
      const bad: string[] = [];
      const seen = new Set<string>();

      const keep = (g: string) => {
        const k = g.toLowerCase();
        if (!seen.has(k)) { seen.add(k); next.push(g); }
      };

      for (const g of row.grade_level) {
        if (VALID_GRADE.test(g.trim())) { keep(g.trim()); continue; }
        const fixed = repairExcelDate(g);
        if (fixed) { changed.push(g); for (const f of fixed) keep(f); }
        else bad.push(g);
      }

      if (bad.length > 0) { stuck.push({ row, bad }); continue; }
      if (changed.length > 0) fixable.push({ row, next, changed });
    }

    const name = (r: Row) => `${r.first_name} ${r.last_name}`.trim();

    console.log(`People with grade levels: ${rows.length}\n`);

    console.log(`Repairable — a spreadsheet turned these into dates (${fixable.length}):`);
    if (fixable.length === 0) console.log("  none.");
    for (const f of fixable) {
      console.log(`  ${name(f.row)} (${f.row.employee_id})`);
      console.log(`      ${JSON.stringify(f.row.grade_level)}  →  ${JSON.stringify(f.next)}`);
    }
    console.log("");

    if (stuck.length > 0) {
      console.log(`Left alone — not a grade, and not safely repairable (${stuck.length}):`);
      for (const s of stuck) {
        console.log(`  ${name(s.row)} (${s.row.employee_id})  ${JSON.stringify(s.row.grade_level)}` +
                    `  — cannot interpret ${s.bad.map((b) => JSON.stringify(b)).join(", ")}`);
      }
      console.log("  Fix these by hand in the Users tab; guessing would repeat the original mistake.\n");
    }

    if (!apply) {
      console.log("DRY RUN — nothing was changed. Re-run with --apply to write.");
      return;
    }
    if (fixable.length === 0) return;

    await client.query("BEGIN");
    try {
      let written = 0;
      for (const f of fixable) {
        const res = await client.query(
          `UPDATE people SET grade_level = $1, updated_at = now() WHERE employee_id = $2`,
          [f.next, f.row.employee_id],
        );
        written += res.rowCount ?? 0;
      }
      if (written !== fixable.length) {
        throw new Error(`expected to update ${fixable.length} row(s), updated ${written} — rolling back`);
      }
      await client.query("COMMIT");
      console.log(`Repaired ${written} person/people.`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Fatal error during grade level cleanup:", err);
  process.exit(1);
});
