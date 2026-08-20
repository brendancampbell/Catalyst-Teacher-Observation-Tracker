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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_YEAR_PATTERNS, matchTestYearPattern } from "@workspace/db/test-year-patterns";

/* A realistic Date.now() — the tests build their names with one. */
const TS = "1755600000000";

describe("names the suite really creates", () => {
  test("matches each shape the tests produce", () => {
    assert.ok(matchTestYearPattern(`TST Empty ${TS}`));
    assert.ok(matchTestYearPattern(`TST Rollover ${TS}`));
    assert.ok(matchTestYearPattern(`TST SY Cache ${TS}`));
    assert.ok(matchTestYearPattern(`TST-INSIGHTS-OLD-YR-${TS}`));
    assert.ok(matchTestYearPattern(`TST Slug Cross-Year ${TS}`));
  });

  test("still recognises the legacy fixed name", () => {
    /* test-rubric-category-domain-validation.ts used this before it was given
       a timestamp. Kept so the cleanup can still find strays left behind by an
       older checkout. */
    assert.ok(matchTestYearPattern("Test Year (slug cross-year)"));
  });

  test("every pattern names the file that creates it", () => {
    /* The list is only trustworthy while it can be re-verified against the
       suite. A pattern with no source is one nobody can check. */
    for (const p of TEST_YEAR_PATTERNS) {
      assert.match(p.source, /^test-[a-z0-9-]+\.ts$/, `${p.label} has no source file`);
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

describe("the pattern list stays in step with the suite", () => {
  /*
   * The list decides what cleanup-test-school-years.ts deletes, so a scratch
   * year whose name it does not recognise is a year that accumulates forever
   * — which is exactly what happened: fourteen copies of one name before
   * anyone noticed, and this file originally credited the wrong test with
   * creating it.
   *
   * So rather than trusting the list, read the suite. Every school year any
   * test inserts must be a name the cleanup can find again.
   */
  test("every school year the tests insert is recognised", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => f.startsWith("test-") && f.endsWith(".ts"));

    /* `name:` within the insert call that follows `insert(schoolYears)`. */
    const INSERT = /insert\(schoolYears\)[\s\S]{0,400}?name:\s*(`[^`]*`|"[^"]*")/g;

    const unrecognised: string[] = [];
    let found = 0;

    for (const file of files) {
      const src = readFileSync(path.join(dir, file), "utf8");
      for (const m of src.matchAll(INSERT)) {
        const literal = m[1]!.slice(1, -1);

        /* Resolve the one interpolation the suite uses. Anything else is a
           name whose shape cannot be checked here, which is itself a problem
           worth failing on rather than skipping quietly. */
        const resolved = literal.replaceAll("${Date.now()}", TS);
        if (resolved.includes("${")) {
          unrecognised.push(`${file}: ${literal} (unresolvable interpolation)`);
          continue;
        }

        found++;
        if (!matchTestYearPattern(resolved)) unrecognised.push(`${file}: ${JSON.stringify(resolved)}`);
      }
    }

    assert.ok(found > 0, "found no insert(schoolYears) calls — has the regex gone stale?");
    assert.deepEqual(
      unrecognised, [],
      "These tests create school years that cleanup-test-school-years.ts cannot find.\n" +
      "Add a pattern to lib/db/src/test-year-patterns.ts, or rename the year to match one:\n" +
      unrecognised.map((u) => "  " + u).join("\n"),
    );
  });
});
