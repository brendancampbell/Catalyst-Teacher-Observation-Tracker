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
 *   pnpm --filter @workspace/db run cleanup:grade-levels -- --apply --drop-invalid
 *
 * --drop-invalid additionally removes values that cannot be read at all,
 * keeping any valid grades beside them. Opt-in, and deliberately NOT part of
 * the deploy: for most of the people it affects the unreadable value is
 * everything they have, so removing it leaves them with no grades and destroys
 * the only clue to what was meant.
 *
 * Dry run by default. Writes happen in one transaction that verifies its own
 * row count before committing.
 */

import { pool } from "./index.js";
/*
 * The real parser, not a copy. The first version of this script had its own
 * simplified one and immediately disagreed with the import: it could not read
 * "5-6-7-8", so thirty people were reported as unrepairable when the actual
 * parser handles them fine.
 */
import { parseGradeLevelsDetailed } from "@workspace/api-types";

interface Row { employee_id: string; first_name: string; last_name: string; grade_level: string[] }

async function run(): Promise<void> {
  const apply = process.argv.includes("--apply");
  /*
   * Strip values that cannot be read at all, keeping any valid grades beside
   * them. Opt-in and NOT part of the deploy, because for most of the people it
   * affects the unreadable value is everything they have — removing it leaves
   * them with no grades, and destroys the only clue to what was meant. "1112"
   * at least tells a person it was probably 11 and 12.
   */
  const dropInvalid = process.argv.includes("--drop-invalid");
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
      /* Parse the stored array exactly as an import would, so hyphenated
         lists split, dates are repaired, and anything left is genuinely
         unreadable rather than merely unparsed by this script. */
      const parsed = parseGradeLevelsDetailed(row.grade_level);

      if (parsed.invalid.length > 0) { stuck.push({ row, bad: parsed.invalid }); continue; }

      const changed = parsed.repaired.map((r) => r.from);
      const sameAsBefore =
        parsed.grades.length === row.grade_level.length &&
        parsed.grades.every((g, i) => g === row.grade_level[i]);
      if (!sameAsBefore) fixable.push({ row, next: parsed.grades, changed });
    }

    const name = (r: Row) => `${r.first_name} ${r.last_name}`.trim();

    console.log(`People with grade levels: ${rows.length}\n`);

    console.log(`Repairable (${fixable.length}) — dates a spreadsheet mangled, and lists never split:`);
    if (fixable.length === 0) console.log("  none.");
    for (const f of fixable) {
      console.log(`  ${name(f.row)} (${f.row.employee_id})`);
      console.log(`      ${JSON.stringify(f.row.grade_level)}  →  ${JSON.stringify(f.next)}`);
    }
    console.log("");

    if (stuck.length > 0) {
      const verb = dropInvalid ? "Unreadable — will be stripped" : "Left alone — cannot be read";
      console.log(`${verb} (${stuck.length}):`);
      let emptied = 0;
      for (const s of stuck) {
        const kept = parseGradeLevelsDetailed(s.row.grade_level).grades;
        if (kept.length === 0) emptied += 1;
        const outcome = dropInvalid
          ? `  →  ${kept.length > 0 ? JSON.stringify(kept) : "NO GRADES LEFT"}`
          : "";
        console.log(`  ${name(s.row)} (${s.row.employee_id})  ${JSON.stringify(s.row.grade_level)}` +
                    `  — cannot interpret ${s.bad.map((b) => JSON.stringify(b)).join(", ")}${outcome}`);
      }
      if (dropInvalid) {
        console.log(`\n  ${emptied} of these would be left with NO grades at all. The unreadable`);
        console.log("  value is the only record of what was meant, so save this list before");
        console.log("  applying — afterwards it is only recoverable from the source spreadsheet.\n");
      } else {
        console.log("  Fix these by hand in the Users tab, or re-run with --drop-invalid to");
        console.log("  strip the unreadable values and keep any valid grades beside them.\n");
      }
    }

    /* Stripping is a second, opt-in kind of write, so it is built here rather
       than folded into `fixable` — the report above must keep the two apart. */
    const toStrip = dropInvalid
      ? stuck.map((s) => ({ row: s.row, next: parseGradeLevelsDetailed(s.row.grade_level).grades }))
      : [];

    if (!apply) {
      console.log("DRY RUN — nothing was changed. Re-run with --apply to write.");
      return;
    }
    if (fixable.length === 0 && toStrip.length === 0) return;

    await client.query("BEGIN");
    try {
      let written = 0;
      for (const f of [...fixable, ...toStrip]) {
        const res = await client.query(
          `UPDATE people SET grade_level = $1, updated_at = now() WHERE employee_id = $2`,
          [f.next.length > 0 ? f.next : null, f.row.employee_id],
        );
        written += res.rowCount ?? 0;
      }
      const expected = fixable.length + toStrip.length;
      if (written !== expected) {
        throw new Error(`expected to update ${expected} row(s), updated ${written} — rolling back`);
      }
      await client.query("COMMIT");
      console.log(`Repaired ${fixable.length} person/people.` +
        (toStrip.length > 0 ? ` Stripped unreadable values from ${toStrip.length}.` : ""));
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
