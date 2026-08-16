/**
 * Migration data-statement guard.
 *
 * Scans every *.sql file in lib/db/migrations/ for DML statements
 * (UPDATE, INSERT INTO, DELETE FROM, MERGE, or WITH-led CTEs).
 *
 * Detection uses the same SQL-aware lexer model as the companion shell script
 * (scripts/check-migration-data-stmts.sh):
 *
 *   1. Recognise single-quoted, double-quoted, and dollar-quoted string
 *      literals.  Their CONTENTS are replaced with empty placeholders so that
 *      DML-looking text inside strings (e.g. 'UPDATE blurb') is never matched.
 *   2. Strip line comments (-- ...) and block comments (/* ... *\/).
 *   3. Split on bare semicolons (outside strings/comments) to produce one
 *      logical statement per array element.
 *   4. Check whether any statement STARTS WITH a DML keyword.
 *
 * If DML is found the file MUST contain ONE of the following markers:
 *
 *   -- ⚠️  DATA BACKFILL — <description>   (banner comment)
 *   -- MIGRATE-DATA: <description>          (machine-readable annotation)
 *
 * Either marker is sufficient.
 *
 * Run:
 *   pnpm --filter @workspace/db run check:migration-data
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

/**
 * SQL-aware lexer — same logical model as the Perl lexer in
 * scripts/check-migration-data-stmts.sh.
 *
 * Returns an array of logical SQL statements.  Each statement has its string
 * literal CONTENTS replaced by empty placeholders, and all comments stripped,
 * so that DML-looking text inside strings can never cause false positives or
 * false negatives.
 *
 * Recognised quoting forms (delimiters preserved; contents blanked):
 *   'single-quoted'    (with '' escape)
 *   "double-quoted"    (with "" escape)
 *   $tag$dollar-quoted$tag$
 *
 * Recognised comment forms (replaced with a single space):
 *   -- line comment
 *   /* block comment *\/
 */
function splitStatements(src: string): string[] {
  const stmts: string[] = [];
  let cur = "";
  let pos = 0;
  const len = src.length;

  while (pos < len) {
    const ch = src[pos];

    // ── Single-quoted string ────────────────────────────────────────────────
    // Parse the whole literal (including '' escapes and E-string backslash
    // escapes), discard its content, emit just empty quotes so no DML text
    // leaks from string bodies.
    //
    // PostgreSQL escape-string literals (E'...' or e'...') allow backslash
    // escapes: \' is an embedded quote (NOT the end of the string), and \\
    // is a literal backslash.  We detect the E prefix in `cur` and enter
    // backslash-aware mode so the string boundary is found correctly.
    if (ch === "'") {
      const isEscape = /[Ee]$/.test(cur); // E'...' or e'...'?
      pos++; // skip opening quote
      while (pos < len) {
        const c = src[pos];
        pos++;
        if (isEscape && c === "\\") {
          pos++; // skip backslash-escaped char (\' or \\)
        } else if (c === "'") {
          if (pos < len && src[pos] === "'") {
            pos++; // skip '' escape
          } else break; // end of string
        }
      }
      // Remove the E/e prefix already appended to cur
      if (isEscape) cur = cur.slice(0, -1);
      cur += "''"; // emit empty placeholder
    }

    // ── Dollar-quoted string ────────────────────────────────────────────────
    // Matches $tag$...$tag$ and $$...$$. Skip content entirely.
    else if (ch === "$") {
      const m = src.slice(pos).match(/^(\$[A-Za-z0-9_]*\$)/);
      if (m) {
        const tag = m[1];
        pos += tag.length; // skip opening tag
        const ep = src.indexOf(tag, pos);
        if (ep >= 0) {
          pos = ep + tag.length; // skip to after closing tag
        } else {
          pos = len; // unclosed — consume rest
        }
        cur += `${tag}${tag}`; // emit empty placeholder, e.g. $$$$
      } else {
        cur += ch;
        pos++;
      }
    }

    // ── Double-quoted identifier ─────────────────────────────────────────────
    // Parse the whole identifier (including "" escapes), discard content.
    else if (ch === '"') {
      pos++; // skip opening quote
      while (pos < len) {
        const c = src[pos];
        pos++;
        if (c === '"') {
          if (pos < len && src[pos] === '"') {
            pos++; // skip "" escape
          } else break;
        }
      }
      cur += '""'; // emit empty placeholder
    }

    // ── Line comment: -- rest of line ───────────────────────────────────────
    else if (ch === "-" && pos + 1 < len && src[pos + 1] === "-") {
      while (pos < len && src[pos] !== "\n") pos++;
      cur += " "; // replace with space
    }

    // ── Block comment: /* ... */ ─────────────────────────────────────────────
    else if (ch === "/" && pos + 1 < len && src[pos + 1] === "*") {
      pos += 2;
      while (pos + 1 < len) {
        if (src[pos] === "*" && src[pos + 1] === "/") {
          pos += 2;
          break;
        }
        pos++;
      }
      cur += " ";
    }

    // ── Statement separator ──────────────────────────────────────────────────
    else if (ch === ";") {
      stmts.push(cur);
      cur = "";
      pos++;
    }

    else {
      cur += ch;
      pos++;
    }
  }

  // Trailing statement without a terminating semicolon
  if (cur.trim()) stmts.push(cur);
  return stmts;
}

// Matches a DML statement at the beginning of a logical statement string
// (after optional leading whitespace).  The `^` anchor (no `m` flag) matches
// only the very start of each statement string, so DML-like tokens on later
// lines of a multi-line statement are not matched.
//
// Note: string literal contents have already been blanked by splitStatements(),
// so this regex cannot match DML text from inside quoted strings.
//
// DO is included because PostgreSQL's DO block executes the dollar-quoted body
// immediately; a DO block in a migration is effectively inline DML and requires
// the same annotation as a bare UPDATE/INSERT/DELETE.
const DML_RE =
  /^\s*(?:UPDATE\b|INSERT\s+INTO\b|DELETE\s+FROM\b|MERGE\b|WITH\b|DO\b)/i;

// The required acknowledgment (checked against the raw source, not the
// processed statements).  Either marker is sufficient.
const ANNOTATION_RE = /^--.*⚠️|^--\s*MIGRATE-DATA:/m;

interface Result {
  file: string;
  hasDml: boolean;
  hasAnnotation: boolean;
  dmlSnippets: string[];
}

function scanFile(filePath: string): Result {
  const src = fs.readFileSync(filePath, "utf-8");
  const stmts = splitStatements(src);

  const dmlSnippets: string[] = [];
  for (const stmt of stmts) {
    if (DML_RE.test(stmt)) {
      dmlSnippets.push(stmt.trim().slice(0, 120));
      if (dmlSnippets.length >= 3) break;
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
    const withDml = files.map(scanFile).filter((r) => r.hasDml).length;
    console.log(
      `✓ ${checked} migration file(s) checked — ` +
        `${withDml} contain DML, all annotated.`
    );
    process.exit(0);
  }

  console.error(
    `\n❌  ${violations.length} migration file(s) contain data statements (DML)\n` +
      `    without a required banner/annotation.\n`
  );
  for (const v of violations) {
    console.error(`  File: ${v.file}`);
    for (const s of v.dmlSnippets) {
      console.error(`    ${s}`);
    }
    console.error("");
  }
  console.error(
    `Add ONE of the following near the top of each flagged file:\n\n` +
      `  -- ⚠️  DATA BACKFILL — <what the DML does>\n` +
      `  -- MIGRATE-DATA: <what the DML does>\n\n` +
      `See lib/db/README.md §Data backfills for the full policy.\n`
  );
  process.exit(1);
}

main();
