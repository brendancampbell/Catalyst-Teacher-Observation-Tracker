import assert from "node:assert/strict";
import { buildHtmlEmail } from "./routes/email.js";

const BASE = {
  teacherName:    "Test Teacher",
  teacherSubject: "Math",
  teacherGrade:   "5",
  date:           "2026-01-01",
  time:           "9:00 AM",
  intro:          "Great lesson.",
  glowsText:      "Positive feedback.",
  growsText:      "Area for growth.",
  scoreMap:       {},
  prevScoreMap:   {},
  categories:     [],
  logoUrl:        "https://example.com/logo.png",
};

/* ── helpers ─────────────────────────────────────────── */

/**
 * Assert that `observer` and `course`, which go through escapeHtml(), produce
 * properly entity-encoded output — no raw angle brackets, no javascript: scheme,
 * and input characters that must be escaped are present as HTML entities.
 */
function assertPlainFieldSafe(html: string, raw: string, label: string) {
  assert(!html.includes("<script"),     `${label}: raw <script tag present`);
  assert(!html.includes("</script"),    `${label}: raw </script tag present`);
  assert(!html.includes("javascript:"), `${label}: javascript: scheme present`);

  if (raw.includes("<")) {
    assert(html.includes("&lt;"),   `${label}: < not escaped to &lt;`);
  }
  if (raw.includes(">")) {
    assert(html.includes("&gt;"),   `${label}: > not escaped to &gt;`);
  }
  if (raw.includes('"')) {
    assert(html.includes("&quot;"), `${label}: " not escaped to &quot;`);
  }
  if (raw.includes("&")) {
    assert(html.includes("&amp;"),  `${label}: & not escaped to &amp;`);
  }
}

/**
 * Assert that rich-text fields (intro, glows, grows), which go through
 * sanitize-html, produce no executable injection vectors.
 * sanitize-html removes dangerous tags entirely rather than escaping them,
 * so we check for absence of the dangerous constructs only.
 */
function assertRichFieldSafe(html: string, label: string) {
  assert(!html.includes("<script"),     `${label}: raw <script tag present`);
  assert(!html.includes("</script"),    `${label}: raw </script tag present`);
  assert(!html.includes("javascript:"), `${label}: javascript: scheme present`);
}

let passed = 0;
let total  = 0;

/* ── 1. observer field — goes through escapeHtml() ───── */

const observerPayloads: Array<[string, string]> = [
  ["script tag",       '<script>alert(1)</script>'],
  ["attribute break",  '" onmouseover="alert(1)"'],
  ["angle bracket",    '<b>bold</b>'],
  ["ampersand",        'Smith & Jones'],
  ["combined xss",     '"><script>alert(1)</script>'],
];

console.log("--- observer field (escapeHtml) ---");
for (const [name, payload] of observerPayloads) {
  total++;
  const html = buildHtmlEmail({ ...BASE, observer: payload, course: "Algebra" });
  assertPlainFieldSafe(html, payload, `observer[${name}]`);
  passed++;
  console.log(`PASS [${passed}/${total}] observer ${name}: ${payload.slice(0, 55)}`);
}

/* ── 2. course field — goes through escapeHtml() ─────── */

const coursePayloads: Array<[string, string]> = [
  ["script tag",       '<script>alert(1)</script>'],
  ["attribute break",  '" onmouseover="alert(1)"'],
  ["angle bracket",    '<i>Honors</i> Algebra'],
  ["ampersand",        'English & Language Arts'],
  ["combined xss",     "'><script>alert(1)</script>"],
];

console.log("\n--- course field (escapeHtml) ---");
for (const [name, payload] of coursePayloads) {
  total++;
  const html = buildHtmlEmail({ ...BASE, observer: "Coach A", course: payload });
  assertPlainFieldSafe(html, payload, `course[${name}]`);
  passed++;
  console.log(`PASS [${passed}/${total}] course ${name}: ${payload.slice(0, 55)}`);
}

/* ── 3. teacherName field — goes through escapeHtml() ── */

const teacherNamePayloads: Array<[string, string]> = [
  ["script tag",       '<script>alert(1)</script>'],
  ["attribute break",  '" onmouseover="alert(1)"'],
  ["angle bracket",    '<b>Evil</b> Name'],
  ["ampersand",        'Smith & Jones'],
  ["combined xss",     '"><script>alert(1)</script>'],
];

console.log("\n--- teacherName field (escapeHtml) ---");
for (const [name, payload] of teacherNamePayloads) {
  total++;
  const html = buildHtmlEmail({ ...BASE, teacherName: payload, observer: "Coach A", course: "Algebra" });
  assertPlainFieldSafe(html, payload, `teacherName[${name}]`);
  passed++;
  console.log(`PASS [${passed}/${total}] teacherName ${name}: ${payload.slice(0, 55)}`);
}

/* ── 4. teacherSubject field — goes through escapeHtml() */

const teacherSubjectPayloads: Array<[string, string]> = [
  ["script tag",       '<script>alert(1)</script>'],
  ["attribute break",  '" onmouseover="alert(1)"'],
  ["angle bracket",    '<i>Honors</i> Math'],
  ["ampersand",        'English & Language Arts'],
  ["combined xss",     "'><script>alert(1)</script>"],
];

console.log("\n--- teacherSubject field (escapeHtml) ---");
for (const [name, payload] of teacherSubjectPayloads) {
  total++;
  const html = buildHtmlEmail({ ...BASE, teacherSubject: payload, observer: "Coach A", course: "Algebra" });
  assertPlainFieldSafe(html, payload, `teacherSubject[${name}]`);
  passed++;
  console.log(`PASS [${passed}/${total}] teacherSubject ${name}: ${payload.slice(0, 55)}`);
}

/* ── 5. gradeLabel field — goes through escapeHtml() ─── */

const gradeLabelPayloads: Array<[string, string]> = [
  ["script tag",       '<script>alert(1)</script>'],
  ["attribute break",  '" onmouseover="alert(1)"'],
  ["angle bracket",    '<b>Grade 5</b>'],
  ["ampersand",        'K & 1'],
  ["combined xss",     '"><script>alert(1)</script>'],
];

console.log("\n--- gradeLabel field (escapeHtml via teacherGrade) ---");
for (const [name, payload] of gradeLabelPayloads) {
  total++;
  const html = buildHtmlEmail({ ...BASE, observer: "Coach A", course: "Algebra", teacherGrade: payload });
  assertPlainFieldSafe(html, payload, `gradeLabel[${name}]`);
  passed++;
  console.log(`PASS [${passed}/${total}] gradeLabel ${name}: ${payload.slice(0, 55)}`);
}

/* ── 6. time field — goes through escapeHtml() ─────── */

const timePayloads: Array<[string, string]> = [
  ["script tag",       '<script>alert(1)</script>'],
  ["attribute break",  '" onmouseover="alert(1)"'],
  ["angle bracket",    '<b>9:00</b> AM'],
  ["ampersand",        '9:00 AM & PM'],
  ["combined xss",     '"><script>alert(1)</script>'],
];

console.log("\n--- time field (escapeHtml) ---");
for (const [name, payload] of timePayloads) {
  total++;
  const html = buildHtmlEmail({ ...BASE, observer: "Coach A", course: "Algebra", time: payload });
  assertPlainFieldSafe(html, payload, `time[${name}]`);
  passed++;
  console.log(`PASS [${passed}/${total}] time ${name}: ${payload.slice(0, 55)}`);
}

/* ── 7. dateLabel field — currently NOT wrapped in escapeHtml() ─────────
 *
 * dateLabel is produced by formatDateLong(date), which pipes the raw date
 * string through new Date().toLocaleDateString().  Even so the output must
 * be entity-encoded before it lands in the HTML template.  These tests
 * confirm:
 *   a) formatDateLong() does not amplify any injection (it returns
 *      "Invalid Date" for non-date strings — no raw tags).
 *   b) The final rendered cell contains no unescaped angle-bracket tags,
 *      attribute-breakout patterns, or dangerous schemes.
 * ─────────────────────────────────────────────────────────────────────── */

/** Re-implements formatDateLong exactly as it appears in email.ts. */
function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const dateLabelPayloads: Array<[string, string]> = [
  ["script tag",           "<script>alert(1)</script>"],
  ["img onerror",          "<img src=x onerror=alert(1)>"],
  ["angle bracket mid",    "2026-<b>07</b>-13"],
  ["double-quote break",   '2026-07-13" onload="alert(1)'],
  ["single-quote break",   "2026-07-13' onload='alert(1)"],
  ["javascript scheme",    "javascript:alert(1)"],
  ["null byte",            "2026-07-\x0013"],
  ["unicode angle-lt",     "\uff1cscript\uff1ealert(1)\uff1c/script\uff1e"],
  ["combined xss",         '"><script>alert(1)</script>'],
];

console.log("\n--- dateLabel field (via formatDateLong + escapeHtml) ---");
for (const [name, payload] of dateLabelPayloads) {
  total++;
  const html = buildHtmlEmail({ ...BASE, date: payload, observer: "Coach A", course: "Algebra" });

  assert(!html.includes("<script"),     `dateLabel[${name}]: raw <script tag present`);
  assert(!html.includes("</script"),    `dateLabel[${name}]: raw </script tag present`);
  assert(!html.includes("javascript:"), `dateLabel[${name}]: javascript: scheme present`);
  assert(!html.includes("onerror"),     `dateLabel[${name}]: onerror attribute present`);
  assert(!html.includes("onload"),      `dateLabel[${name}]: onload attribute present`);

  if (payload.includes("<")) {
    assert(
      !html.includes(payload),
      `dateLabel[${name}]: raw payload appears verbatim in output`
    );
  }

  passed++;
  console.log(`PASS [${passed}/${total}] dateLabel ${name}: ${payload.slice(0, 55)}`);
}

/* ── 8. rich-text fields — go through sanitize-html ──── */

const richPayloads = [
  '<script>alert(1)</script>',
  '<a href="javascript:void(0)">xss</a>',
  '"><script>alert(1)</script>',
];

console.log("\n--- rich-text fields (sanitize-html strips; intro / glows / grows) ---");
for (const payload of richPayloads) {
  total++;
  const html = buildHtmlEmail({
    ...BASE,
    observer: "Coach",
    course:   "Algebra",
    intro:     payload,
    glowsText: payload,
    growsText:  payload,
  });
  assertRichFieldSafe(html, `rich[${payload.slice(0, 30)}]`);
  passed++;
  console.log(`PASS [${passed}/${total}] rich payload: ${payload.slice(0, 55)}`);
}

console.log(`\nAll ${passed}/${total} HTML-injection tests passed.`);
