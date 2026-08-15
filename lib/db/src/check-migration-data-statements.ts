/**
 * Migration data-statement guard.
 *
 * Scans every *.sql file in lib/db/migrations/ for DML statements
 * (UPDATE … SET, INSERT INTO …, DELETE FROM …).  If DML is found the file
 * MUST contain a machine-readable annotation on a line by itself:
 *
 *   -- MIGRATE-DATA: <description>
 *
 * The description should explain:
 *  - what the DML does, AND
 *  - whether a matching ensure*() call exists in api-server/src/index.ts
 *    (required when the data would be missing from environments bootstrapped
 *    with drizzle-kit push instead of migrate).
 *
 * Without this annotation the script exits 1 so the task validation fails
 * before the branch is merged.
 *
 * Run:
 *   pnpm --filter @workspace/db run check:migration-data
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

// Matches a standalone DML statement at the beginning of a line (after
// optional leading whitespace).  "ON UPDATE / ON DELETE" inside FK
// constraint definitions never appear at the start of a line, so this
// regex naturally excludes them.
const DML_RE =
  /^\s*(?:UPDATE\b|INSERT\s+INTO\b|DELETE\s+FROM\b)/im;

// The required acknowledgment token.  The rest of the line is free-form.
const ANNOTATION_RE = /^--\s*MIGRATE-DATA:/m;

interface Result {
  file: string;
  hasDml: boolean;
  hasAnnotation: boolean;
  dmlSnippets: string[]; // first few matching lines, for diagnostics
}

function scanFile(filePath: string): Result {
  const src = fs.readFileSync(filePath, "utf-8");
  const lines = src.split("\n");

  const dmlSnippets: string[] = [];
  for (const line of lines) {
    if (DML_RE.test(line)) {
      dmlSnippets.push(line.trim());
      if (dmlSnippets.length >= 3) break; // enough for the error message
    }
  }

  return {
    file: path.basename(filePath),
    hasDml: dmlSnippets.length > 0,
    hasAnnotation: ANNOTATION_RE.test(src),
    dmlSnippets,
  };
}

function main(): void {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));

  if (files.length === 0) {
    console.log("No migration files found — nothing to check.");
    process.exit(0);
  }

  const violations: Result[] = [];

  for (const fp of files) {
    const result = scanFile(fp);
    if (result.hasDml && !result.hasAnnotation) {
      violations.push(result);
    }
  }

  if (violations.length === 0) {
    const checked = files.length;
    const withDml = files
      .map(scanFile)
      .filter((r) => r.hasDml).length;
    console.log(
      `✓ ${checked} migration file(s) checked — ` +
        `${withDml} contain DML, all annotated.`
    );
    process.exit(0);
  }

  console.error(
    `\n❌  ${violations.length} migration file(s) contain data statements (DML)\n` +
      `    without a required  -- MIGRATE-DATA:  annotation.\n`
  );

  for (const v of violations) {
    console.error(`  File: ${v.file}`);
    for (const s of v.dmlSnippets) {
      console.error(`    ${s}`);
    }
    console.error("");
  }

  console.error(
    `Add a comment like the following near the top of each flagged file:\n\n` +
      `  -- MIGRATE-DATA: <what the DML does and whether an ensure*() mirror exists>\n\n` +
      `See lib/db/README.md §Data backfills for the full policy.\n`
  );

  process.exit(1);
}

main();
