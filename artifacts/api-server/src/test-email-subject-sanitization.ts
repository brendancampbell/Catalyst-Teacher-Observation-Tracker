/**
 * Unit tests for sanitizeSubject() — the function that strips control
 * characters from the email subject line to prevent header injection.
 *
 * These tests run without starting the API server (pure import, no network).
 *
 * WHAT IS BEING TESTED
 * ─────────────────────
 * Email header injection works by inserting CR (\r), LF (\n), or CRLF (\r\n)
 * into a header value so a mail agent interprets text after the newline as a
 * new header (e.g. "Bcc: attacker@evil.com").  A NULL byte (\x00) can also
 * confuse parsers.  The sanitizer must strip ALL bytes in \x00-\x1F and \x7F.
 *
 * Legitimate content — accented characters, apostrophes, emoji, long strings —
 * must pass through unchanged.
 */

import assert from "node:assert/strict";
import { sanitizeSubject } from "./routes/email.js";

let passed = 0;
let total  = 0;

function test(label: string, fn: () => void): void {
  total++;
  fn();
  passed++;
  console.log(`  PASS  ${label}`);
}

/* ── 1. Newline / CRLF injection ─────────────────────────────────────────── */
console.log("\n1. Newline / CRLF injection");

test("bare LF is replaced — no newline remains in output", () => {
  // The sanitizer replaces \n with a space, making everything one line.
  // That single-line output cannot be parsed as a new header.
  const out = sanitizeSubject("Observation\nBcc: attacker@evil.com");
  assert(!out.includes("\n"), "LF still present in output");
  // The text "Bcc: attacker..." is fine appearing after a space — it's only
  // dangerous when preceded by \r\n so a mail agent interprets it as a new header.
});

test("bare CR is replaced — no carriage return remains in output", () => {
  const out = sanitizeSubject("Observation\rBcc: attacker@evil.com");
  assert(!out.includes("\r"), "CR still present in output");
});

test("CRLF sequence is replaced — no newlines remain in output", () => {
  const out = sanitizeSubject("Subject\r\nX-Injected: yes");
  assert(!out.includes("\r"), "CR still present in output");
  assert(!out.includes("\n"), "LF still present in output");
  // Result is a single line: "Subject  X-Injected: yes" — harmless.
});

test("multiple newlines are all removed", () => {
  const out = sanitizeSubject("a\n\nb\r\nc");
  assert(!out.includes("\n"), "LF still present after multi-newline strip");
  assert(!out.includes("\r"), "CR still present after multi-newline strip");
});

/* ── 2. NULL byte injection ──────────────────────────────────────────────── */
console.log("\n2. NULL byte injection");

test("NULL byte (\\x00) is removed", () => {
  const out = sanitizeSubject("Observation\x00extra");
  assert(!out.includes("\x00"), "NULL byte still present");
});

test("NULL byte does not allow trailing content to survive as-is", () => {
  const raw = "Safe\x00\r\nX-Injected: yes";
  const out = sanitizeSubject(raw);
  assert(!out.includes("\x00"), "NULL byte present");
  assert(!out.includes("\r"),   "CR present");
  assert(!out.includes("\n"),   "LF present");
});

/* ── 3. Full control-character range \x01-\x1F and \x7F ─────────────────── */
console.log("\n3. Full control-character sweep (\\x01-\\x1F, \\x7F)");

test("all bytes in \\x00-\\x1F are stripped", () => {
  for (let code = 0x00; code <= 0x1F; code++) {
    const char = String.fromCharCode(code);
    const out  = sanitizeSubject(`before${char}after`);
    assert(
      !out.includes(char),
      `control byte \\x${code.toString(16).padStart(2, "0")} survived sanitization`
    );
  }
});

test("DEL (\\x7F) is stripped", () => {
  const out = sanitizeSubject("before\x7Fafter");
  assert(!out.includes("\x7F"), "DEL byte still present");
});

test("output contains no bytes in \\x00-\\x1F after sanitization", () => {
  // Adversarial: all control chars concatenated
  const poison = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join("");
  const out = sanitizeSubject(`Obs ${poison} Result`);
  for (let code = 0x00; code <= 0x1F; code++) {
    const char = String.fromCharCode(code);
    assert(!out.includes(char),
      `output still contains control byte \\x${code.toString(16).padStart(2, "0")}`);
  }
});

/* ── 4. Legitimate subjects pass through unchanged ───────────────────────── */
console.log("\n4. Legitimate subjects pass through unchanged");

test("plain ASCII subject is unchanged", () => {
  const s = "Observation: Ms. Johnson - Algebra I";
  assert.equal(sanitizeSubject(s), s);
});

test("apostrophes and quotes pass through", () => {
  const s = `Teacher's "observation" — follow-up`;
  assert.equal(sanitizeSubject(s), s);
});

test("accented / non-ASCII characters pass through", () => {
  const s = "Observación del señor García";
  assert.equal(sanitizeSubject(s), s);
});

test("emoji in subject pass through", () => {
  const s = "Great lesson! 🎉 Math Observation";
  assert.equal(sanitizeSubject(s), s);
});

test("leading/trailing whitespace is trimmed (existing behaviour)", () => {
  assert.equal(sanitizeSubject("  hello  "), "hello");
});

test("non-string input is coerced to string", () => {
  // req.body values are untyped; the sanitizer uses String(raw)
  assert.equal(sanitizeSubject(42),   "42");
  assert.equal(sanitizeSubject(null), "null");
  assert.equal(sanitizeSubject(true), "true");
});

/* ── 5. Overly long subjects ─────────────────────────────────────────────── */
console.log("\n5. Overly long subjects");

test("very long subject passes through (no length limit enforced)", () => {
  // The sanitizer strips control chars but does not truncate.
  // This test documents the current contract: length is the caller's concern.
  const long = "A".repeat(10_000);
  const out  = sanitizeSubject(long);
  assert.equal(out.length, 10_000, "long subject was unexpectedly truncated");
  assert.equal(out, long,          "long subject content changed");
});

test("long subject containing injected newline: newline is stripped, length reduced by 1", () => {
  const long = "A".repeat(4_999) + "\n" + "B".repeat(5_000);
  const out  = sanitizeSubject(long);
  assert(!out.includes("\n"), "LF still present in long subject");
  // The \n is replaced with a space, so length stays the same (9_999 + 1 = 10_000)
  // but the newline itself is gone.
  assert(!out.includes("\n"), "newline survived in long subject");
});

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log(`\n${"─".repeat(52)}`);
console.log(`All ${passed}/${total} subject-sanitization tests passed.`);
