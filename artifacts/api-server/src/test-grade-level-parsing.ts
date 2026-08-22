/**
 * Unit tests for grade-level parsing.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-grade-level-parsing.ts
 *
 * No database or server required — parseGradeLevels is pure, which is why it
 * lives in its own module rather than inside roster.ts.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseGradeLevels, parseGradeLevelsDetailed, repairExcelDate, isValidGrade } from "./lib/grade-levels";

describe("parseGradeLevels", () => {
  test("splits the comma-separated form real exports produce", () => {
    assert.deepEqual(parseGradeLevels("4, 5, 6"), ["4", "5", "6"]);
    assert.deepEqual(parseGradeLevels("4,5,6"), ["4", "5", "6"]);
  });

  test("still splits the legacy hyphen form the template documented", () => {
    assert.deepEqual(parseGradeLevels("6-7-8"), ["6", "7", "8"]);
    assert.deepEqual(parseGradeLevels("K-1"), ["K", "1"]);
    assert.deepEqual(parseGradeLevels("9-10-11-12"), ["9", "10", "11", "12"]);
  });

  test("does NOT split a hyphen that is part of a grade name", () => {
    /* The reason hyphens cannot be split unconditionally. */
    assert.deepEqual(parseGradeLevels("Pre-K"), ["Pre-K"]);
    assert.deepEqual(parseGradeLevels("Pre-K, K, 1"), ["Pre-K", "K", "1"]);
  });

  test("accepts semicolons, and mixed separators in one field", () => {
    assert.deepEqual(parseGradeLevels("4;5;6"), ["4", "5", "6"]);
    assert.deepEqual(parseGradeLevels("K-1, 2"), ["K", "1", "2"]);
  });

  test("passes an array through — the manual editor's shape", () => {
    assert.deepEqual(parseGradeLevels(["6", "7", "8"]), ["6", "7", "8"]);
    assert.deepEqual(parseGradeLevels([6, 7]), ["6", "7"]);
  });

  test("de-duplicates case-insensitively, keeping first-seen form", () => {
    assert.deepEqual(parseGradeLevels("K, k, K"), ["K"]);
    assert.deepEqual(parseGradeLevels("5, 5, 6"), ["5", "6"]);
  });

  test("returns an empty list for empty or non-string input", () => {
    assert.deepEqual(parseGradeLevels(""), []);
    assert.deepEqual(parseGradeLevels("   "), []);
    assert.deepEqual(parseGradeLevels(", ,"), []);
    assert.deepEqual(parseGradeLevels(null), []);
    assert.deepEqual(parseGradeLevels(undefined), []);
    assert.deepEqual(parseGradeLevels(42), []);
  });

  test("normalises the decimals spreadsheets produce", () => {
    /* A grade column formatted as a number exports 5 as "5.00". */
    assert.deepEqual(parseGradeLevels("5.00"), ["5"]);
    assert.deepEqual(parseGradeLevels("5.00, 6.00"), ["5", "6"]);
    assert.deepEqual(parseGradeLevels("10.00"), ["10"]);
    /* …but a genuine decimal is not a grade and is left alone. */
    assert.deepEqual(parseGradeLevels("5.5"), ["5.5"]);
  });

  test("an imported teacher now matches a hand-edited one", () => {
    /* The bug this fixes: these produced ["6-7-8"] and ["6","7","8"]. */
    assert.deepEqual(parseGradeLevels("6-7-8"), parseGradeLevels(["6", "7", "8"]));
    assert.deepEqual(parseGradeLevels("6, 7, 8"), parseGradeLevels(["6", "7", "8"]));
    assert.deepEqual(parseGradeLevels("6.00, 7.00, 8.00"), parseGradeLevels(["6", "7", "8"]));
  });
});

describe("isValidGrade", () => {
  test("accepts the grades this system recognises", () => {
    for (const g of ["Pre-K", "PreK", "PK", "TK", "K", "k", "1", "9", "12"]) {
      assert.equal(isValidGrade(g), true, g);
    }
  });

  test("rejects anything else", () => {
    /* The point of the whole exercise: a teacher cannot be assigned to a
       thirteenth grade, or to a month. */
    for (const g of ["13", "0", "99", "Oct 11", "5.5", "Grade 4", ""]) {
      assert.equal(isValidGrade(g), false, g);
    }
  });
});

describe("repairExcelDate", () => {
  test("turns a mangled pair back into two grades", () => {
    /* Reported from production: a teacher of grades 10 and 11 recorded as
       teaching "Oct 11", because Excel decided the cell was a date. */
    assert.deepEqual(repairExcelDate("Oct 11"), ["10", "11"]);
    assert.deepEqual(repairExcelDate("OCT-11"), ["10", "11"]);
    assert.deepEqual(repairExcelDate("October 11"), ["10", "11"]);
  });

  test("gives the same answer whichever way round the date was read", () => {
    /* A grade is 1-12 and so is a month, so the pair is the same set either
       way. That is what makes repairing this safe rather than a guess. */
    assert.deepEqual(repairExcelDate("11-Oct"), ["10", "11"]);
    assert.deepEqual(repairExcelDate("10 Nov"), ["10", "11"]);
    assert.deepEqual(repairExcelDate("10/11/2026"), ["10", "11"]);
    assert.deepEqual(repairExcelDate("11/10/2026"), ["10", "11"]);
    assert.deepEqual(repairExcelDate("2026-10-11"), ["10", "11"]);
  });

  test("collapses a pair that means one grade", () => {
    assert.deepEqual(repairExcelDate("Nov 11"), ["11"]);
  });

  test("refuses when the day cannot be a grade", () => {
    /* "Oct 25" is a real date, not a mangled pair of grades. Repairing it
       would be inventing something. */
    assert.equal(repairExcelDate("Oct 25"), null);
    assert.equal(repairExcelDate("25-Dec"), null);
    assert.equal(repairExcelDate("3/15/2026"), null);
  });

  test("refuses anything that is not a date at all", () => {
    for (const v of ["13", "Grade 4", "Maths", "", "K"]) {
      assert.equal(repairExcelDate(v), null, v);
    }
  });
});

describe("parseGradeLevelsDetailed", () => {
  test("passes valid grades through untouched", () => {
    const r = parseGradeLevelsDetailed("4, 5, 6");
    assert.deepEqual(r.grades, ["4", "5", "6"]);
    assert.deepEqual(r.repaired, []);
    assert.deepEqual(r.invalid, []);
  });

  test("repairs an Excel date and says it did", () => {
    const r = parseGradeLevelsDetailed("Oct 11");
    assert.deepEqual(r.grades, ["10", "11"]);
    assert.deepEqual(r.repaired, [{ from: "Oct 11", to: ["10", "11"] }]);
    assert.deepEqual(r.invalid, []);
  });

  test("reports what it cannot repair, and keeps the rest", () => {
    /* The row still fails, but the message can name the offending value
       rather than the whole field. */
    const r = parseGradeLevelsDetailed("4, 13, 5");
    assert.deepEqual(r.grades, ["4", "5"]);
    assert.deepEqual(r.invalid, ["13"]);
  });

  test("does not duplicate a grade a repair also produced", () => {
    const r = parseGradeLevelsDetailed("10, Oct 11");
    assert.deepEqual(r.grades, ["10", "11"]);
  });
});
