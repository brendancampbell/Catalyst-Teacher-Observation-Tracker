/**
 * Unit tests for the test-school-year name patterns.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-school-year-name-patterns.ts
 *
 * No database — which is the point. These decide what
 * cleanup-test-school-years.ts DELETES, and every observation, action step and
 * rubric set is scoped by a school year. A false negative leaves debris. A
 * false positive destroys a year of real work, so the tests below spend most
 * of their effort on names that must NOT match.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TEST_YEAR_PATTERNS, matchTestYearPattern } from "@workspace/db/test-year-patterns";

/* A realistic Date.now() — the tests build their names with one. */
const TS = "1755600000000";

describe("names the suite really creates", () => {
  test("matches each shape the tests produce", () => {
    assert.ok(matchTestYearPattern(`TST Empty ${TS}`));
    assert.ok(matchTestYearPattern(`TST Rollover ${TS}`));
    assert.ok(matchTestYearPattern(`TST SY Cache ${TS}`));
    assert.ok(matchTestYearPattern(`TST-INSIGHTS-OLD-YR-${TS}`));
    assert.ok(matchTestYearPattern("Test Year (slug cross-year)"));
  });

  test("every pattern names the file that creates it", () => {
    /* The list is only trustworthy while it can be re-verified against the
       suite. A pattern with no source is one nobody can check. */
    for (const p of TEST_YEAR_PATTERNS) {
      assert.match(p.source, /\.ts$/, `${p.label} has no source file`);
      assert.ok(p.label.length > 0);
    }
  });
});

describe("names it must never match", () => {
  test("leaves real school years alone", () => {
    for (const name of ["2024-2025", "2025-2026", "2026-2027", "SY 2026-2027"]) {
      assert.equal(matchTestYearPattern(name), null, `${name} must not match`);
    }
  });

  test("leaves human-made years that merely look testish", () => {
    /* Dev has a "Test" and a "New Test". No test creates those, so a person
       did — they get reported for review, never deleted automatically. */
    for (const name of ["Test", "New Test", "Testing", "Test Year", "Contest Year"]) {
      assert.equal(matchTestYearPattern(name), null, `${name} must not match`);
    }
  });

  test("does not treat the prefix as a wildcard", () => {
    /* The regression this file was written for. With LIKE patterns
       ("TST Rollover %") the first three of these all matched, including a
       name someone might choose specifically to keep it. */
    assert.equal(matchTestYearPattern("TST Rollover 123 (keep)"), null);
    assert.equal(matchTestYearPattern(`TST Rollover ${TS} KEEP`), null);
    assert.equal(matchTestYearPattern("TST Empty — real year, do not delete"), null);
    assert.equal(matchTestYearPattern("TST Rollover"), null);
  });

  test("is anchored at the front too", () => {
    assert.equal(matchTestYearPattern(`Old TST Rollover ${TS}`), null);
    assert.equal(matchTestYearPattern(`xTST-INSIGHTS-OLD-YR-${TS}`), null);
    assert.equal(matchTestYearPattern("My Test Year (slug cross-year)"), null);
  });

  test("requires a timestamp, not just any digits", () => {
    /* Short numbers are the shape a person types; a 13-digit epoch is not. */
    assert.equal(matchTestYearPattern("TST Empty 1"), null);
    assert.equal(matchTestYearPattern("TST Empty 2026"), null);
    assert.equal(matchTestYearPattern("TST SY Cache 12345"), null);
    assert.ok(matchTestYearPattern("TST Empty 1755600000"));   // 10 digits, allowed
  });

  test("treats the parentheses in the exact name literally", () => {
    /* Escaped, not a capture group — otherwise this claims a different name. */
    assert.equal(matchTestYearPattern("Test Year slug cross-year"), null);
  });
});
