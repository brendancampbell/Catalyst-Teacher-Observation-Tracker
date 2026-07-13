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

/* ── 9. score table cat.label — goes through escapeHtml() ─── */

const catLabelPayloads: Array<[string, string]> = [
  ["script tag",      '<script>alert(1)</script>'],
  ["attribute break", '" onmouseover="alert(1)"'],
  ["img onerror",     '<img src=x onerror=alert(1)>'],
  ["angle bracket",   '<b>Instruction</b>'],
  ["ampersand",       'A & B Category'],
  ["combined xss",    '"><script>alert(1)</script>'],
];

console.log("\n--- score table cat.label (escapeHtml) ---");
for (const [name, payload] of catLabelPayloads) {
  total++;
  const html = buildHtmlEmail({
    ...BASE,
    observer: "Coach A",
    course: "Algebra",
    categories: [
      { label: payload, domains: [{ slug: "d1", label: "Safe Domain" }] },
    ],
  });
  assertPlainFieldSafe(html, payload, `cat.label[${name}]`);
  assert(
    !html.includes(payload),
    `cat.label[${name}]: raw payload appears verbatim in output`
  );
  passed++;
  console.log(`PASS [${passed}/${total}] cat.label ${name}: ${payload.slice(0, 55)}`);
}

/* ── 10. score table domain.label — goes through escapeHtml() ─ */

const domainLabelPayloads: Array<[string, string]> = [
  ["script tag",      '<script>alert(1)</script>'],
  ["attribute break", '" onmouseover="alert(1)"'],
  ["img onerror",     '<img src=x onerror=alert(1)>'],
  ["angle bracket",   '<em>Engagement</em>'],
  ["ampersand",       'Wait Time & Pacing'],
  ["combined xss",    "'><script>alert(1)</script>"],
];

console.log("\n--- score table domain.label (escapeHtml) ---");
for (const [name, payload] of domainLabelPayloads) {
  total++;
  const html = buildHtmlEmail({
    ...BASE,
    observer: "Coach A",
    course: "Algebra",
    scoreMap: { "d1": 3 },
    categories: [
      { label: "Safe Category", domains: [{ slug: "d1", label: payload }] },
    ],
  });
  assertPlainFieldSafe(html, payload, `domain.label[${name}]`);
  assert(
    !html.includes(payload),
    `domain.label[${name}]: raw payload appears verbatim in output`
  );
  passed++;
  console.log(`PASS [${passed}/${total}] domain.label ${name}: ${payload.slice(0, 55)}`);
}

/* ── 11. multiple categories and domains all escaped ────────── */

console.log("\n--- multiple cat/domain labels all escaped ---");
total++;
{
  const html = buildHtmlEmail({
    ...BASE,
    observer: "Coach A",
    course: "Algebra",
    scoreMap: { "d1": 2, "d2": 4 },
    categories: [
      {
        label: '<b>Cat One</b>',
        domains: [{ slug: "d1", label: '<em>Domain One</em>' }],
      },
      {
        label: '<b>Cat Two</b>',
        domains: [{ slug: "d2", label: '<em>Domain Two</em>' }],
      },
    ],
  });
  const rawTags = ["<b>Cat One</b>", "<b>Cat Two</b>", "<em>Domain One</em>", "<em>Domain Two</em>"];
  for (const tag of rawTags) {
    assert(!html.includes(tag), `multiple labels: raw tag "${tag}" must not appear in output`);
  }
  assert(html.includes("&lt;b&gt;Cat One&lt;/b&gt;"), "cat.label tags must be escaped");
  assert(html.includes("&lt;em&gt;Domain One&lt;/em&gt;"), "domain.label tags must be escaped");
  passed++;
  console.log(`PASS [${passed}/${total}] multiple cat/domain labels escaped`);
}

/* ── 12. legitimate special-character labels — correct round-trip ─────────
 *
 * escapeHtml() must encode characters to valid HTML entities so that email
 * clients render them as the original readable text.  These are NOT injection
 * payloads — they are real label names that contain &, apostrophes, parens,
 * or dashes.  The test asserts:
 *
 *   a) The raw character does NOT appear verbatim where it would be ambiguous
 *      (& must become &amp;, ' must become &#39;).
 *   b) The correct HTML entity IS present in the output (so the email client
 *      will render the correct visible character).
 *   c) No double-encoding occurred (e.g. &amp;amp; must not be present).
 *   d) Parentheses, hyphens, and digits pass through unchanged.
 */

interface LegitCase {
  name: string;
  catLabel: string;
  domainLabel: string;
  /** Entities that must appear in the rendered HTML */
  requiredEntities: string[];
  /** Substrings that must NOT appear verbatim (only checked when they would
   *  be ambiguous — not checked for parens/digits which are never escaped). */
  forbiddenVerbatim: string[];
  /** Substrings that must NOT appear (double-encoding guard). */
  forbiddenDoubleEncoded: string[];
}

const legitCases: LegitCase[] = [
  {
    name:               "ampersand in category (Reading & Writing)",
    catLabel:           "Reading & Writing",
    domainLabel:        "Fluency",
    requiredEntities:   ["Reading &amp; Writing"],
    forbiddenVerbatim:  [],               // "&" alone appears inside &amp; — checked via entity
    forbiddenDoubleEncoded: ["&amp;amp;"],
  },
  {
    name:               "ampersand in domain (Wait Time & Pacing)",
    catLabel:           "Instruction",
    domainLabel:        "Wait Time & Pacing",
    requiredEntities:   ["Wait Time &amp; Pacing"],
    forbiddenVerbatim:  [],
    forbiddenDoubleEncoded: ["&amp;amp;"],
  },
  {
    name:               "apostrophe in category (Student's Work)",
    catLabel:           "Student's Work",
    domainLabel:        "Portfolio Quality",
    requiredEntities:   ["Student&#39;s Work"],
    forbiddenVerbatim:  ["Student's Work"],   // raw ' must be encoded
    forbiddenDoubleEncoded: ["&#39;&#39;", "&amp;#39;"],
  },
  {
    name:               "apostrophe in domain (Teacher's Moves)",
    catLabel:           "Culture",
    domainLabel:        "Teacher's Moves",
    requiredEntities:   ["Teacher&#39;s Moves"],
    forbiddenVerbatim:  ["Teacher's Moves"],
    forbiddenDoubleEncoded: ["&#39;&#39;", "&amp;#39;"],
  },
  {
    name:               "parenthesized abbreviation (ELL (English Language Learner))",
    catLabel:           "ELL Support",
    domainLabel:        "ELL (English Language Learner)",
    requiredEntities:   ["ELL (English Language Learner)"],  // parens pass through unchanged
    forbiddenVerbatim:  [],
    forbiddenDoubleEncoded: [],
  },
  {
    name:               "combined — ampersand + apostrophe + parens",
    catLabel:           "Math & Science (Gr. 6–8)",
    domainLabel:        "Student's Problem-Solving",
    requiredEntities:   ["Math &amp; Science (Gr. 6–8)", "Student&#39;s Problem-Solving"],
    forbiddenVerbatim:  ["Math & Science", "Student's Problem"],
    forbiddenDoubleEncoded: ["&amp;amp;", "&amp;#39;"],
  },
];

console.log("\n--- legitimate special-character labels (correct round-trip) ---");
for (const tc of legitCases) {
  total++;
  const html = buildHtmlEmail({
    ...BASE,
    observer: "Coach A",
    course:   "Algebra",
    scoreMap: { d1: 2 },
    categories: [
      { label: tc.catLabel, domains: [{ slug: "d1", label: tc.domainLabel }] },
    ],
  });

  for (const entity of tc.requiredEntities) {
    assert(
      html.includes(entity),
      `${tc.name}: expected entity "${entity}" not found in HTML`,
    );
  }
  for (const raw of tc.forbiddenVerbatim) {
    assert(
      !html.includes(raw),
      `${tc.name}: raw string "${raw}" must not appear verbatim`,
    );
  }
  for (const dbl of tc.forbiddenDoubleEncoded) {
    assert(
      !html.includes(dbl),
      `${tc.name}: double-encoded sequence "${dbl}" must not appear`,
    );
  }

  passed++;
  console.log(`PASS [${passed}/${total}] ${tc.name}`);
}

console.log(`\nAll ${passed}/${total} HTML-injection tests passed.`);
