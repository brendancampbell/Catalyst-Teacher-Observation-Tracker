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

/* ── 3. rich-text fields — go through sanitize-html ──── */

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
