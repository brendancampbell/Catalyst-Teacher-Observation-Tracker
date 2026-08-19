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
import { parseGradeLevels } from "./lib/grade-levels";

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
