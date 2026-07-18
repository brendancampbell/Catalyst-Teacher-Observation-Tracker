/**
 * Structural guard — catch any unescaped interpolation in buildHtmlEmail
 * before it ships.
 *
 * HOW IT WORKS
 * ────────────
 * A flat scan finds EVERY ${ occurrence inside buildHtmlEmail (including
 * those inside nested template literals and IIFEs) and checks the start
 * of each expression against:
 *
 *   1. SAFE_WRAPPERS   — calls that begin with escapeHtml( / richToEmailHtml(
 *                        / a known pure-numeric helper
 *   2. IIFE_RE         — the action-step IIFE (() => { … })()
 *   3. NEW_DATE_RE     — new Date().getFullYear() (numeric, not user input)
 *   4. APPROVED_BARE_VARS — exact bare identifiers that are demonstrably safe
 *                           (pre-built HTML or computed numbers); each entry
 *                           requires a justification comment
 *   5. APPROVED_TERNARIES — ternary expressions whose user-supplied variable
 *                           is wrapped in escapeHtml() inside the truthy branch
 *
 * Any expression that does NOT match any of the above causes the test to FAIL
 * with a clear message.  This catches forms that a narrower bare-var regex
 * would miss, including:
 *
 *   ${newField || ""}    — logical-OR default
 *   ${fmt(newField)}     — unrecognized wrapper function
 *   ${obj?.field}        — optional-chain property access
 *   ${newField ? a : b}  — new ternary not in the approved list
 *
 * HOW TO ADD A NEW FIELD SAFELY
 * ──────────────────────────────
 * Option A (preferred): wrap it in escapeHtml(newField) in the template.
 *   → No change to this file needed; the guard passes automatically.
 *
 * Option B: if the value is demonstrably safe without escaping (computed
 *   number, pre-built HTML that already applies escapeHtml, etc.), add it
 *   to APPROVED_BARE_VARS or APPROVED_TERNARIES with a justification.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

/* ── Classification constants ─────────────────────────────────────────────── */

/**
 * Interpolations whose expression STARTS WITH one of these strings are safe.
 * All of these either apply escapeHtml internally or produce only numeric / CSS
 * values that contain no user-supplied strings.
 */
const SAFE_WRAPPER_PREFIXES: readonly string[] = [
  "escapeHtml(",
  "richToEmailHtml(",
  "scoreBg(",      // returns a CSS hex color from a numeric score
  "scoreColor(",   // returns a CSS hex color from a numeric score
  "scoreText(",    // returns "0" | "0.5" | "1" | "—" from a numeric score
  "trendHtml(",    // returns a Unicode arrow span from numeric comparison
];

/** IIFE — the action-step block handles its own escaping internally. */
const IIFE_RE = /^\(\s*\(\s*\)\s*=>/;

/** Copyright year — a number, never user input. */
const NEW_DATE_RE = /^new\s+Date\(\)/;

/**
 * Bare identifier interpolations that are demonstrably safe WITHOUT being
 * wrapped in escapeHtml().  Each entry's key is the EXACT identifier that
 * must appear as  ${key}  (no dotted access, no operator, nothing after the
 * identifier but optional whitespace then }).
 *
 * Adding an entry here without a justification comment will be rejected in
 * code review.
 */
const APPROVED_BARE_VARS: ReadonlyMap<string, string> = new Map([
  ["scoreTableRows",
   "pre-built HTML: loop applies escapeHtml(cat.label) and escapeHtml(domain.label)"],
  ["overallAvg",
   "number.toFixed(2) — computed from numeric scores only, never user input"],
  ["avg",
   "number.toFixed(2) — sub-average, computed from numeric scores only"],
  ["byLine",
   "pre-built: escapeHtml(masteredStep.masteredByName) applied in its own assignment"],
  ["assignedLine",
   "pre-built: escapeHtml(stillOpenStep.assignedByName) applied in its own assignment"],
  ["rows",
   "pre-built action-step rows; each row uses escapeHtml() / richToEmailHtml()"],
  // NOTE: teacherGrade appears ONLY in the intermediate assignment
  //   const gradeLabel = teacherGrade ? `Grade ${teacherGrade}` : "";
  // The resulting gradeLabel is then interpolated via escapeHtml(gradeLabel).
  // Do NOT add ${teacherGrade} directly to the HTML template.
  ["teacherGrade",
   "only in gradeLabel assignment; gradeLabel wrapped via escapeHtml(gradeLabel) in template"],
]);

/**
 * Ternary-expression interpolations: the user-supplied variable is used ONLY
 * inside the truthy branch, wrapped in escapeHtml().
 * Stored as regexes matching the START of the expression string.
 */
const APPROVED_TERNARY_PREFIXES: ReadonlyArray<[RegExp, string]> = [
  [/^time\s*\?/,           "optional row — escapeHtml(time) inside truthy branch"],
  [/^teacherSubject\s*\?/, "optional row — escapeHtml(teacherSubject) inside truthy branch"],
  [/^gradeLabel\s*\?/,     "optional row — escapeHtml(gradeLabel) inside truthy branch"],
  [/^course\s*\?/,         "optional row — escapeHtml(course) inside truthy branch"],
];

/* ── Core classifier ─────────────────────────────────────────────────────── */

/**
 * Classify the start of a template interpolation expression.
 * @param exprStart — the first ~100 chars after the opening ${
 * @returns a descriptive string if safe, or null if unknown / unsafe
 */
function classifyExpressionStart(exprStart: string): string | null {
  // 1. Safe wrapper functions
  for (const prefix of SAFE_WRAPPER_PREFIXES) {
    if (exprStart.startsWith(prefix)) return `safe wrapper: ${prefix}`;
  }

  // 2. IIFE
  if (IIFE_RE.test(exprStart)) return "safe: IIFE (action-step block)";

  // 3. new Date()
  if (NEW_DATE_RE.test(exprStart)) return "safe: new Date() — numeric year";

  // 4. Extract the FIRST bare identifier (stops at any non-identifier char)
  //    Note: we intentionally exclude '.' from the char class so that
  //    dotted access like obj.field is NOT treated as a single safe identifier.
  const identMatch = exprStart.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
  if (identMatch) {
    const ident = identMatch[1];
    const afterIdent = exprStart.slice(ident.length);

    // Bare variable: identifier immediately followed by optional whitespace + }
    if (/^[ \t\n]*\}/.test(afterIdent)) {
      if (APPROVED_BARE_VARS.has(ident)) {
        return `approved bare var: ${APPROVED_BARE_VARS.get(ident)}`;
      }
      // Bare var NOT in allowlist → fall through to return null
    }

    // Ternary expression: check approved-ternary prefixes
    for (const [re, reason] of APPROVED_TERNARY_PREFIXES) {
      if (re.test(exprStart)) return `approved ternary: ${reason}`;
    }
  }

  return null; // unknown / unsafe
}

/* ── Self-test fixtures ───────────────────────────────────────────────────── */
// These prove the guard catches the expression forms the code review flagged.
// Run before the main scan so failures surface clearly.

console.log("--- self-test: classifier on synthetic expressions ---");
let stPassed = 0;
let stTotal = 0;

function expectSafe(exprStart: string, label: string): void {
  stTotal++;
  const result = classifyExpressionStart(exprStart);
  assert.notEqual(result, null,
    `[self-test] Expected SAFE but got null for "${label}": ${exprStart.slice(0, 60)}`);
  stPassed++;
  console.log(`  PASS (safe)    ${label}`);
}

function expectUnsafe(exprStart: string, label: string): void {
  stTotal++;
  const result = classifyExpressionStart(exprStart);
  assert.equal(result, null,
    `[self-test] Expected UNSAFE but got "${result}" for "${label}": ${exprStart.slice(0, 60)}`);
  stPassed++;
  console.log(`  PASS (caught)  ${label}`);
}

// Forms that MUST be safe
expectSafe('escapeHtml(observer)', "escapeHtml() wrapper");
expectSafe('richToEmailHtml(intro, "#475569")', "richToEmailHtml() wrapper");
expectSafe('scoreBg(val)', "scoreBg() numeric helper");
expectSafe('scoreText(val)', "scoreText() numeric helper");
expectSafe('trendHtml(domain.slug, val, prevScoreMap)', "trendHtml() numeric helper");
expectSafe('(() => {', "IIFE opening");
expectSafe('new Date().getFullYear()', "new Date() year");
expectSafe('scoreTableRows}', "approved bare var: scoreTableRows");
expectSafe('avg}', "approved bare var: avg");
expectSafe('byLine}', "approved bare var: byLine");
expectSafe('time ? `<td>${escapeHtml(time)}</td>` : ""', "time ternary");
expectSafe('teacherSubject ? `<td>${escapeHtml(teacherSubject)}</td>` : ""',
           "teacherSubject ternary");

// Forms that MUST be caught (the patterns the code review flagged)
expectUnsafe('newField || ""',
             '${newField || ""} — logical-OR bypass');
expectUnsafe('fmt(newField)}',
             '${fmt(newField)} — unrecognized wrapper function');
expectUnsafe('obj?.field}',
             '${obj?.field} — optional-chain access');
expectUnsafe('newField}',
             '${newField} — bare unknown variable');
expectUnsafe('newField ? "a" : "b"',
             '${newField ? "a" : "b"} — unapproved ternary');
expectUnsafe('time}',
             '${time} — user field used as bare var (must be time ?)');

console.log(`\nSelf-tests: ${stPassed}/${stTotal} passed.\n`);

/* ── Main scan ───────────────────────────────────────────────────────────── */

const source = readFileSync(join(__dir, "routes/email.ts"), "utf8");

const FUNC_START_MARKER = "export function buildHtmlEmail(";
const FUNC_END_MARKER   = "/* ── POST /api/email/send-observation";

const funcStart = source.indexOf(FUNC_START_MARKER);
assert.notEqual(funcStart, -1,
  `GUARD SETUP FAIL: "${FUNC_START_MARKER}" not found in routes/email.ts.\n` +
  "Update FUNC_START_MARKER if the function was renamed.");

const funcEnd = source.indexOf(FUNC_END_MARKER, funcStart);
assert.notEqual(funcEnd, -1,
  `GUARD SETUP FAIL: "${FUNC_END_MARKER}" not found after buildHtmlEmail.\n` +
  "Update FUNC_END_MARKER if the section comment changed.");

const funcBody = source.slice(funcStart, funcEnd);

console.log("--- scanning buildHtmlEmail for unprotected interpolations ---");

const problems: string[] = [];
let totalInterpolations = 0;

// Flat scan: find every ${ in funcBody without brace-depth nesting.
// This is intentionally exhaustive — it checks inner expressions inside IIFEs
// and ternary branches as well as the outer ones.  All inner expressions in the
// current codebase are safe, and any NEW unsafe inner expression is caught.
let pos = 0;
while (pos < funcBody.length - 1) {
  const idx = funcBody.indexOf("${", pos);
  if (idx === -1) break;
  pos = idx + 2;
  totalInterpolations++;

  // Extract first ~100 chars of the expression for classification
  const exprStart = funcBody.slice(pos, pos + 100).replace(/\n[ \t]*/g, " ").trimStart();
  const classification = classifyExpressionStart(exprStart);

  if (classification === null) {
    const preview = exprStart.slice(0, 70);
    problems.push(`\${${preview}${exprStart.length > 70 ? "…" : ""}`);
  }
}

/* ── Results ─────────────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(
    `\nFAIL: ${problems.length} unprotected interpolation(s) in buildHtmlEmail:\n`
  );
  for (const p of problems) {
    console.error(`  ${p}`);
  }
  console.error(`
Each expression above is neither:
  • wrapped in escapeHtml() or richToEmailHtml()
  • a known pure-numeric/CSS helper (scoreBg, scoreColor, scoreText, trendHtml)
  • a listed IIFE or new Date() expression
  • an entry in APPROVED_BARE_VARS or APPROVED_TERNARIES

Fix options:
  1. Wrap the new field: escapeHtml(newField)  ← preferred
  2. Add it to APPROVED_BARE_VARS / APPROVED_TERNARIES with a justification.`);
  process.exit(1);
}

/* ── Stale-allowlist notice (non-failing) ───────────────────────────────── */

const staleVars: string[] = [];
for (const key of APPROVED_BARE_VARS.keys()) {
  if (!funcBody.includes(`\${${key}}`)) staleVars.push(key);
}
const staleTernaries: string[] = [];
for (const [re, reason] of APPROVED_TERNARY_PREFIXES) {
  // Search for any ${ followed by text matching the ternary prefix
  const found = (() => {
    let p = 0;
    while (p < funcBody.length - 1) {
      const i = funcBody.indexOf("${", p);
      if (i === -1) break;
      p = i + 2;
      const snip = funcBody.slice(p, p + 40).replace(/\n[ \t]*/g, " ").trimStart();
      if (re.test(snip)) return true;
    }
    return false;
  })();
  if (!found) staleTernaries.push(reason);
}

if (staleVars.length > 0 || staleTernaries.length > 0) {
  console.warn("NOTE (non-failing): Some allowlist entries were not found in buildHtmlEmail.");
  console.warn("Consider removing them to keep the list tidy:\n");
  for (const v of staleVars)      console.warn(`  APPROVED_BARE_VARS: "${v}"`);
  for (const t of staleTernaries) console.warn(`  APPROVED_TERNARIES: "${t}"`);
  console.warn("");
}

console.log(
  `PASS: ${totalInterpolations} interpolations scanned, all safe.`
);
console.log("No unprotected fields detected in buildHtmlEmail.");
