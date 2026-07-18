/**
 * Structural guard: every bare ${variable} interpolation inside buildHtmlEmail
 * must be listed in APPROVED_BARE_VARS below with a justification.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The per-field injection tests in test-email-html-injection.ts only cover
 * fields that existed when those tests were written. If a developer adds a new
 * user-supplied field to buildHtmlEmail and interpolates it as ${newField}
 * without escapeHtml(), the injection tests do not catch it — the new field is
 * simply never exercised.
 *
 * This guard closes the gap: it statically reads routes/email.ts, extracts every
 * ${identifier} bare interpolation inside buildHtmlEmail, and FAILS if any
 * identifier is not in the approved allowlist below.
 *
 * HOW TO ADD A NEW FIELD SAFELY
 * ──────────────────────────────
 * Option A (preferred): wrap the new field in escapeHtml() in the template.
 *   → The guard passes automatically; no change to this file needed.
 *
 * Option B: if the field is demonstrably safe without escaping (e.g. a
 *   pre-built HTML string, a computed number), add it to APPROVED_BARE_VARS
 *   with a one-line justification explaining why it cannot carry an injection.
 *
 * HOW THE SCAN WORKS
 * ──────────────────
 * The regex matches  ${IDENTIFIER}  where:
 *   - IDENTIFIER starts with a letter / _ / $
 *   - The next non-whitespace character is }  (closes the interpolation)
 * This deliberately does NOT match:
 *   - ${escapeHtml(x)}     — function call, ( follows identifier
 *   - ${richToEmailHtml()} — same
 *   - ${scoreBg(val)}      — same
 *   - ${time ? `...` : ""} — ternary, ? follows identifier
 *   - ${(() => { ... })()} — IIFE, starts with (
 *   - ${new Date().getFullYear()} — space follows "new", not }
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const EMAIL_SRC = join(__dir, "routes/email.ts");
const source = readFileSync(EMAIL_SRC, "utf8");

/* ── Extract buildHtmlEmail function body ─────────────────────────────────── */

const FUNC_START_MARKER  = "export function buildHtmlEmail(";
const FUNC_END_MARKER    = "/* ── POST /api/email/send-observation";

const funcStart = source.indexOf(FUNC_START_MARKER);
assert.notEqual(funcStart, -1,
  `GUARD SETUP FAIL: "${FUNC_START_MARKER}" not found in routes/email.ts.\n` +
  "If the function was renamed, update FUNC_START_MARKER in this file.");

const funcEnd = source.indexOf(FUNC_END_MARKER, funcStart);
assert.notEqual(funcEnd, -1,
  `GUARD SETUP FAIL: "${FUNC_END_MARKER}" not found after buildHtmlEmail.\n` +
  "If the section comment was changed, update FUNC_END_MARKER in this file.");

const funcBody = source.slice(funcStart, funcEnd);

/* ── Approved bare-variable interpolations ────────────────────────────────────
 *
 * Any ${identifier} that is NOT wrapped in escapeHtml() or richToEmailHtml()
 * must appear here.  Adding an entry without a justification comment will be
 * rejected in code review.
 *
 * ─────────────────────────────────────────────────────────────────────────── */
const APPROVED_BARE_VARS: ReadonlyMap<string, string> = new Map([

  // Pre-built HTML string — the loop that builds it applies escapeHtml() to
  // every cat.label and domain.label before appending.
  ["scoreTableRows",
   "pre-built HTML string; loop applies escapeHtml(cat.label) and escapeHtml(domain.label)"],

  // Computed decimal strings produced by Number.toFixed(2) on numeric scores.
  // These are never user-supplied strings.
  ["overallAvg",
   "number.toFixed(2) on numeric scores; never user-supplied input"],
  ["avg",
   "number.toFixed(2) sub-average; never user-supplied input"],

  // Pre-built HTML fragments inside the action-step IIFE.
  // Each is constructed from escapeHtml() / richToEmailHtml() calls before use.
  ["byLine",
   "pre-built: escapeHtml(masteredStep.masteredByName) applied in its assignment"],
  ["assignedLine",
   "pre-built: escapeHtml(stillOpenStep.assignedByName) applied in its assignment"],
  ["rows",
   "pre-built action-step rows; each row uses escapeHtml() / richToEmailHtml()"],

  // Used ONLY in the intermediate assignment:
  //   const gradeLabel = teacherGrade ? `Grade ${teacherGrade}` : "";
  // The resulting gradeLabel is then interpolated via escapeHtml(gradeLabel)
  // in the return template — so the raw value never reaches the HTML output.
  ["teacherGrade",
   "only appears in gradeLabel assignment; gradeLabel is wrapped in escapeHtml() in the template"],
]);

/* ── Scan for bare ${identifier} interpolations ──────────────────────────── */

// Matches  ${IDENTIFIER}  — identifier immediately followed by optional
// whitespace then the closing }.  Does NOT match function calls like
// ${escapeHtml(x)} because the identifier is followed by ( not }.
const BARE_VAR_RE = /\$\{([a-zA-Z_$][a-zA-Z0-9_$.]*)[ \t]*\}/g;

const unknown: string[] = [];
let m: RegExpExecArray | null;

while ((m = BARE_VAR_RE.exec(funcBody)) !== null) {
  const name = m[1];
  if (!APPROVED_BARE_VARS.has(name)) {
    unknown.push(name);
  }
}

/* ── Report ─────────────────────────────────────────────────────────────────── */

if (unknown.length > 0) {
  console.error("FAIL: Bare (unescaped) interpolations found in buildHtmlEmail:");
  console.error("  These identifiers appear as \${x} without escapeHtml() or richToEmailHtml(),");
  console.error("  and are NOT listed in APPROVED_BARE_VARS:\n");
  for (const name of unknown) {
    console.error(`    \${${name}}`);
  }
  console.error(`
Fix options:
  1. Wrap each new field in escapeHtml(${unknown[0] ?? "newField"}) in the template (preferred).
  2. Add it to APPROVED_BARE_VARS in test-email-escape-guard.ts with a justification.`);
  process.exit(1);
}

/* ── Stale-allowlist check (warn only, never fails) ─────────────────────── */
//
// If an entry in APPROVED_BARE_VARS no longer appears in the function body,
// print a notice so the allowlist stays tidy.  This is informational only —
// removing a bare interpolation (e.g. by wrapping it in escapeHtml()) is always
// safe and should not break the build.

const stale: string[] = [];
for (const name of APPROVED_BARE_VARS.keys()) {
  if (!funcBody.includes(`\${${name}}`)) {
    stale.push(name);
  }
}

if (stale.length > 0) {
  console.warn("NOTE (non-failing): The following APPROVED_BARE_VARS entries are no longer");
  console.warn("found in buildHtmlEmail.  Consider removing them from the allowlist:\n");
  for (const name of stale) {
    console.warn(`  "${name}" — ${APPROVED_BARE_VARS.get(name)}`);
  }
  console.warn("");
}

console.log(`PASS: All ${APPROVED_BARE_VARS.size} allowlisted bare interpolations accounted for.`);
console.log("No unknown unescaped fields detected in buildHtmlEmail.");
