/**
 * Cleanup: remove school years left behind by the integration test suite.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Several integration tests create a scratch school year and never delete it.
 * Measured 2026-08-19 in dev: 17 school years, of which 2 are real. The
 * School Years admin tab lists all 17, so choosing the right one to activate
 * during a rollover means picking a real year out of a list mostly made of
 * debris — at the exact moment when picking the wrong one takes the app down.
 *
 * The strays are also evidence, which is why this is filed next to the
 * demo-teachers flake: a suite that leaves rows behind is a suite that can
 * leave other state behind.
 *
 * ── What it will and will not delete ──────────────────────────────────────
 * It deletes ONLY years whose name matches a pattern that a test in this
 * repository is known to create, and only when the year is not active. The
 * patterns are listed below with the file that produces each one; they were
 * read out of the suite rather than guessed.
 *
 * Everything else is fail-closed, deliberately:
 *
 *   - A year with a name that merely LOOKS like a test ("Test", "New Test")
 *     is reported and left alone. No test creates those names, so a person
 *     made them, and a person can delete them. Pass --also=<id,...> to
 *     include one explicitly.
 *
 *   - A year carrying rows in any table that is not on the DELETABLE list —
 *     observations and action steps above all — is reported and skipped.
 *     Those are work product, not test debris.
 *
 *   - The referencing tables are DISCOVERED from pg_constraint, not
 *     hardcoded. If a new table gains a school_year_id, it will not be on the
 *     DELETABLE list, so this script starts refusing rather than silently
 *     deleting data nobody told it about.
 *
 * ── Running it ────────────────────────────────────────────────────────────
 *   pnpm --filter @workspace/db run cleanup:test-school-years
 *   pnpm --filter @workspace/db run cleanup:test-school-years -- --apply
 *   pnpm --filter @workspace/db run cleanup:test-school-years -- --apply --also=42
 *
 * Dry run by default: prints exactly what it would delete and changes nothing.
 * All writes happen in ONE transaction which is rolled back if the verification
 * at the end does not agree with the plan.
 *
 * NOT wired into post-merge.sh. Deleting rows is not something that should
 * happen because someone pulled.
 */

import { pool } from "./index.js";
import { matchTestYearPattern } from "./test-year-patterns.js";

/**
 * Tables whose rows may be removed along with a test year.
 *
 * Anything NOT listed here blocks the delete. That asymmetry is the whole
 * safety property: a table added to the schema later is unknown, and unknown
 * means "stop", not "assume it is debris".
 *
 * rubric_categories and rubric_domains also cascade from rubric_sets; they are
 * named anyway because rubric_domains carries its own school_year_id and could
 * in principle point at a year whose set is elsewhere.
 */
const DELETABLE = new Set(["assignments", "rubric_domains", "rubric_categories", "rubric_sets"]);

interface Fk { table: string; column: string; onDelete: string }
interface Year { id: number; name: string; status: string; created_at: string }

/** Postgres spells the FK delete action as a single char in confdeltype. */
const DELETE_ACTION: Record<string, string> = {
  a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT",
};

async function run(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const alsoArg = process.argv.find((a) => a.startsWith("--also="));
  const alsoIds = new Set(
    (alsoArg ? alsoArg.slice("--also=".length).split(",") : [])
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );

  const client = await pool.connect();
  try {
    /* ── Which tables point at school_years? Ask the database. ────────── */
    const { rows: fkRows } = await client.query<{ table_name: string; column_name: string; del: string }>(`
      SELECT con.conrelid::regclass::text AS table_name,
             att.attname                  AS column_name,
             con.confdeltype              AS del
        FROM pg_constraint con
        JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
       WHERE con.contype = 'f'
         AND con.confrelid = 'school_years'::regclass
       ORDER BY 1, 2
    `);
    const fks: Fk[] = fkRows.map((r) => ({
      table: r.table_name.replace(/^public\./, ""),
      column: r.column_name,
      onDelete: DELETE_ACTION[r.del] ?? r.del,
    }));

    console.log(`Tables referencing school_years (${fks.length}):`);
    for (const fk of fks) {
      const disposition = fk.onDelete === "SET NULL" ? "cleared by the database"
        : DELETABLE.has(fk.table) ? "deleted with the year"
        : "BLOCKS deletion";
      console.log(`  ${fk.table}.${fk.column}  on delete ${fk.onDelete}  → ${disposition}`);
    }
    console.log("");

    /* ── All non-active years, so the report can show what was skipped ── */
    const { rows: years } = await client.query<Year>(`
      SELECT id, name, status, created_at::text
        FROM school_years
       ORDER BY id
    `);

    const planned: Year[] = [];
    const blocked: { year: Year; reason: string }[] = [];
    const ignored: Year[] = [];

    console.log(`School years present: ${years.length}`);
    console.log("");
    console.log("Test debris:");

    for (const year of years) {
      const isTestName = matchTestYearPattern(year.name) !== null;
      const forced = alsoIds.has(year.id);

      if (!isTestName && !forced) { ignored.push(year); continue; }

      if (year.status === "active") {
        blocked.push({ year, reason: "it is the ACTIVE school year" });
        continue;
      }

      /* Count dependants in every referencing table. */
      const problems: string[] = [];
      let removable = 0;
      for (const fk of fks) {
        if (fk.onDelete === "SET NULL") continue;   // the database handles it
        const { rows } = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${quoteIdent(fk.table)} WHERE ${quoteIdent(fk.column)} = $1`,
          [year.id],
        );
        const n = Number(rows[0]!.n);
        if (n === 0) continue;
        if (DELETABLE.has(fk.table)) removable += n;
        else problems.push(`${n} row(s) in ${fk.table}`);
      }

      /* An observation in ANOTHER year can point at a rubric set belonging to
         this one, and that FK is ON DELETE RESTRICT. Catch it here with a
         clear message rather than as a raw constraint violation mid-delete. */
      const { rows: pinned } = await client.query<{ n: string }>(`
        SELECT count(*)::text AS n
          FROM observations o
          JOIN rubric_sets rs ON rs.id = o.rubric_set_id
         WHERE rs.school_year_id = $1
      `, [year.id]);
      if (Number(pinned[0]!.n) > 0) {
        problems.push(`${pinned[0]!.n} observation(s) elsewhere use its rubric sets`);
      }

      if (problems.length > 0) {
        blocked.push({ year, reason: problems.join("; ") });
      } else {
        planned.push(year);
        const why = forced && !isTestName ? "forced with --also" : `matches "${matchTestYearPattern(year.name)!.label}"`;
        console.log(`  will delete  #${year.id}  ${JSON.stringify(year.name)}  (${why}, ${removable} dependent row(s))`);
      }
    }

    if (planned.length === 0) console.log("  nothing to delete.");
    console.log("");

    if (blocked.length > 0) {
      console.log(`Skipped — ${blocked.length} year(s) that look like tests but carry data:`);
      for (const b of blocked) console.log(`  #${b.year.id}  ${JSON.stringify(b.year.name)}  — ${b.reason}`);
      console.log("");
    }

    const suspicious = ignored.filter((y) => /test/i.test(y.name));
    if (suspicious.length > 0) {
      console.log(`Left alone — ${suspicious.length} year(s) named like a test but created by no test:`);
      for (const y of suspicious) {
        console.log(`  #${y.id}  ${JSON.stringify(y.name)}  (${y.status}, created ${y.created_at.slice(0, 10)})`);
      }
      console.log("  A person made these. Review them, then re-run with --also=<id,...> to include one.\n");
    }

    console.log(`School years after this runs: ${years.length - planned.length} (from ${years.length})`);
    console.log("");

    if (!apply) {
      console.log("DRY RUN — nothing was changed. Re-run with --apply to delete.");
      return;
    }
    if (planned.length === 0) return;

    /*
     * Guard the WRITE, not the read. A dry run against any database is
     * harmless and occasionally useful; deleting rows in production is not.
     *
     * Deliberately NOT the guard seed-dev.ts uses. That one refuses any
     * non-localhost DATABASE_URL, which is correct for seeding but would
     * refuse this script in the only place it is meant to run: the Replit
     * workspace, whose development database is remote. NODE_ENV is the signal
     * that actually distinguishes the two.
     *
     * The pattern allowlist is the real protection — production has no years
     * named `TST Rollover <timestamp>`, so `planned` would be empty there
     * anyway. This is the second lock on the same door.
     */
    if (process.env.NODE_ENV === "production" && process.env.CLEANUP_FORCE !== "true") {
      console.error(
        "\nERROR: refusing to delete school years with NODE_ENV=production.\n" +
        "  Re-run without --apply to inspect, or set CLEANUP_FORCE=true if this\n" +
        "  really is a development database with NODE_ENV set wrongly.",
      );
      process.exit(1);
    }

    /* ── Apply, in one transaction, verified before it commits ────────── */
    await client.query("BEGIN");
    try {
      const ids = planned.map((y) => y.id);

      /*
       * Children first, deepest first: rubric_domains reference both
       * rubric_categories and rubric_sets; rubric_categories reference
       * rubric_sets. All three cascade from rubric_sets, but they are deleted
       * explicitly and in order so a failure names the table it happened in
       * rather than surfacing as an opaque cascade.
       *
       * Side effect worth knowing: chat rows carry rubric_set_slug as free
       * text with no foreign key, so any chat attached to a deleted test set
       * keeps a slug that now resolves to nothing. That is the app's existing
       * slug-based model, not something introduced here.
       */
      await client.query(`DELETE FROM assignments      WHERE school_year_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM rubric_domains   WHERE school_year_id = ANY($1::int[])`, [ids]);
      await client.query(`
        DELETE FROM rubric_domains
         WHERE rubric_set_id IN (SELECT id FROM rubric_sets WHERE school_year_id = ANY($1::int[]))`, [ids]);
      await client.query(`
        DELETE FROM rubric_categories
         WHERE rubric_set_id IN (SELECT id FROM rubric_sets WHERE school_year_id = ANY($1::int[]))`, [ids]);
      await client.query(`DELETE FROM rubric_sets      WHERE school_year_id = ANY($1::int[])`, [ids]);

      const { rowCount } = await client.query(`DELETE FROM school_years WHERE id = ANY($1::int[])`, [ids]);

      /* Verify inside the transaction: the number deleted must be the number
         planned, and nothing may be left pointing at a deleted year. */
      if (rowCount !== planned.length) {
        throw new Error(`expected to delete ${planned.length} year(s), deleted ${rowCount} — rolling back`);
      }
      const { rows: leftover } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM school_years WHERE id = ANY($1::int[])`, [ids]);
      if (Number(leftover[0]!.n) !== 0) {
        throw new Error(`${leftover[0]!.n} target year(s) still present — rolling back`);
      }

      await client.query("COMMIT");
      console.log(`Deleted ${rowCount} school year(s): ${ids.join(", ")}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

/** Identifiers come from pg_constraint, but quote them anyway. */
function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`unexpected identifier: ${name}`);
  return `"${name}"`;
}

run().catch((err) => {
  console.error("Fatal error during test school year cleanup:", err);
  process.exit(1);
});
