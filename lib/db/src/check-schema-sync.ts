/**
 * Schema-sync check: compares what Drizzle declares against the live database.
 *
 * Exits 0 when they agree, 1 with a summary when they do not.
 *
 * Only Drizzle-managed tables (exported from schema/index.ts) are examined.
 * Tables that exist in the database but not in the schema — notably `session`,
 * which belongs to connect-pg-simple — are deliberately ignored.
 *
 * Drift reported:
 *   MISSING TABLE   schema declares a table the database does not have
 *   PHANTOM COLUMN  schema declares a column the database does not have
 *   UNDECLARED COL  the database has a column the schema does not know about
 *   TYPE MISMATCH   same column name, different type (or a different length)
 *   NULLABILITY     same column, disagreeing on NOT NULL
 *   MISSING INDEX   schema declares an index the database does not have
 *
 * ── Why the last three exist ──────────────────────────────────────────────
 * This check compared column NAMES and nothing else, which left two blind
 * spots that both cost real time:
 *
 * Indexes were invisible. Migration 0009 is nothing but CREATE INDEX
 * statements, so when its tracking row was baselined into production on the
 * evidence of one index colliding, nothing could verify the other seventeen —
 * including school_years_single_active_uniq, the constraint that stops a
 * database holding two active school years.
 *
 * Types were invisible. A column declared `text` that the database holds as
 * `varchar(50)` passed silently, until the fifty-first character.
 *
 * Run:
 *   pnpm --filter @workspace/db run check:schema-sync
 */

import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema/index.js";
import {
  compareNullability,
  compareType,
  missingIndexes,
  type DbColumn,
  type DeclaredColumn,
} from "./schema-compare.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getDbColumns(tableName: string): Promise<Map<string, DbColumn> | null> {
  const res = await pool.query<{
    column_name: string;
    udt_name: string;
    character_maximum_length: number | null;
    is_nullable: string;
  }>(
    `SELECT column_name, udt_name, character_maximum_length, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = $1`,
    [tableName],
  );
  if (res.rows.length === 0) return null;
  return new Map(res.rows.map((r) => [r.column_name, {
    udtName:   r.udt_name,
    maxLength: r.character_maximum_length,
    nullable:  r.is_nullable === "YES",
  }]));
}

async function getDbIndexes(tableName: string): Promise<string[]> {
  const res = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
    [tableName],
  );
  return res.rows.map((r) => r.indexname);
}

async function main() {
  const drift: string[] = [];
  /* Types the check could not map, so did not compare. Reported as a note,
     never as drift — see the governing rule in schema-compare.ts. */
  const unchecked: string[] = [];
  const seenTables = new Set<string>();

  for (const [exportName, value] of Object.entries(schema)) {
    if (!is(value, PgTable)) continue;

    const tableName = getTableName(value);
    /* A table can be exported under more than one name; check it once. */
    if (seenTables.has(tableName)) continue;
    seenTables.add(tableName);

    const cols = getTableColumns(value);
    const dbCols = await getDbColumns(tableName);

    if (dbCols === null) {
      drift.push(`MISSING TABLE   : "${tableName}" (Drizzle export "${exportName}") — declared in schema but absent from DB`);
      continue;
    }

    const schemaColNames = new Set(Object.values(cols).map((c) => c.name));

    for (const col of Object.values(cols)) {
      const actual = dbCols.get(col.name);
      if (!actual) {
        drift.push(`PHANTOM COLUMN  : ${tableName}.${col.name} — declared in schema but missing from DB`);
        continue;
      }

      const declared: DeclaredColumn = {
        sqlType: col.getSQLType(),
        /* A primary key is never nullable, whether or not notNull was set. */
        notNull: col.notNull || col.primary,
      };

      const type = compareType(declared, actual);
      if (type.kind === "mismatch") {
        drift.push(`TYPE MISMATCH   : ${tableName}.${col.name} — schema declares ${type.declared}, DB has ${type.actual}`);
      } else if (type.kind === "unknown") {
        unchecked.push(`${tableName}.${col.name} (${type.declared})`);
      }

      const nullability = compareNullability(declared, actual);
      if (nullability.kind === "mismatch") {
        drift.push(`NULLABILITY     : ${tableName}.${col.name} — schema declares ${nullability.declared}, DB is ${nullability.actual}`);
      }
    }

    for (const col of dbCols.keys()) {
      if (!schemaColNames.has(col)) {
        drift.push(`UNDECLARED COL  : ${tableName}.${col} — present in DB but not declared in schema`);
      }
    }

    /* Indexes. One direction only: Postgres creates its own for primary keys
       and unique constraints, and those are never in Drizzle's config. */
    const declaredIndexes = getTableConfig(value).indexes
      .map((i) => i.config.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);

    for (const name of missingIndexes(declaredIndexes, await getDbIndexes(tableName))) {
      drift.push(`MISSING INDEX   : ${tableName}.${name} — declared in schema but absent from DB`);
    }
  }

  await pool.end();

  if (unchecked.length > 0) {
    console.log(`Note: ${unchecked.length} column type(s) could not be mapped and were not compared:`);
    for (const line of unchecked) console.log("  " + line);
    console.log("");
  }

  if (drift.length === 0) {
    console.log(`✓ Schema sync OK — ${seenTables.size} tables checked, no drift detected.`);
    process.exit(0);
  }

  console.error(`\nSchema drift detected — ${drift.length} issue(s):\n`);
  for (const line of drift) console.error("  " + line);
  console.error(
    "\nFix: generate a migration for the change with" +
    "\n  pnpm --filter @workspace/db run generate" +
    "\nthen apply it with" +
    "\n  pnpm --filter @workspace/db run migrate" +
    "\nNever reach for `push` or `push-force` on a tracked environment — see lib/db/README.md.",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error during schema sync check:", err);
  process.exit(1);
});
