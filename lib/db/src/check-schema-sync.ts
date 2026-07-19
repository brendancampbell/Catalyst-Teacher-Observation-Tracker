/**
 * Schema-sync check: compares every Drizzle-managed table's declared columns
 * against the live PostgreSQL database.
 *
 * Exits 0 if schema and DB are in sync.
 * Exits 1 (with a summary) if any drift is detected.
 *
 * Only Drizzle-managed tables (those exported from schema/index.ts) are
 * examined.  Tables that live in the DB but are not in the schema (e.g. the
 * `session` table managed by connect-pg-simple) are intentionally ignored.
 *
 * Two kinds of drift are reported:
 *   MISSING TABLE   — schema declares a table that does not exist in the DB
 *   PHANTOM COLUMN  — schema declares a column that is absent from the DB
 *                     (this is the class of bug that caused "column does not
 *                      exist" test failures after migration 0005)
 *   UNDECLARED COL  — DB has a column that the schema does not know about
 *                     (won't cause crashes but indicates the schema is stale)
 *
 * Run:
 *   pnpm --filter @workspace/db run check:schema-sync
 */

import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getDbColumns(tableName: string): Promise<Set<string> | null> {
  const res = await pool.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = $1`,
    [tableName],
  );
  if (res.rows.length === 0) return null;
  return new Set(res.rows.map((r) => r.column_name));
}

async function main() {
  const drift: string[] = [];

  for (const [exportName, value] of Object.entries(schema)) {
    if (!is(value, PgTable)) continue;

    const tableName = getTableName(value);
    const cols      = getTableColumns(value);
    const schemaCols = new Set(Object.values(cols).map((c) => c.name));

    const dbCols = await getDbColumns(tableName);

    if (dbCols === null) {
      drift.push(`MISSING TABLE   : "${tableName}" (Drizzle export "${exportName}") — declared in schema but absent from DB`);
      continue;
    }

    for (const col of schemaCols) {
      if (!dbCols.has(col)) {
        drift.push(`PHANTOM COLUMN  : ${tableName}.${col} — declared in schema but missing from DB`);
      }
    }

    for (const col of dbCols) {
      if (!schemaCols.has(col)) {
        drift.push(`UNDECLARED COL  : ${tableName}.${col} — present in DB but not declared in schema`);
      }
    }
  }

  await pool.end();

  if (drift.length === 0) {
    console.log("✓ Schema sync OK — no drift detected.");
    process.exit(0);
  }

  console.error(`\nSchema drift detected — ${drift.length} issue(s):\n`);
  for (const line of drift) console.error("  " + line);
  console.error(
    "\nFix: update the relevant schema file in lib/db/src/schema/ OR apply" +
    " the missing migration with:  pnpm --filter @workspace/db run push-force",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error during schema sync check:", err);
  process.exit(1);
});
