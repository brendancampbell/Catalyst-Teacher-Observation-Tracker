/**
 * Unit tests for employee-ID canonicalisation.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-employee-id.ts
 *
 * No database required.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canonicalEmployeeId } from "./lib/employee-id";

describe("canonicalEmployeeId", () => {
  test("ignores the leading zeros a spreadsheet drops", () => {
    /* The real case: HR stores 015473, the export writes 15473. */
    assert.equal(canonicalEmployeeId("015473"), canonicalEmployeeId("15473"));
    assert.equal(canonicalEmployeeId("0014720"), canonicalEmployeeId("14720"));
  });

  test("leaves an id with no padding alone", () => {
    assert.equal(canonicalEmployeeId("15473"), "15473");
    assert.equal(canonicalEmployeeId("EMP001"), "emp001");
  });

  test("does not collapse ids that genuinely differ", () => {
    assert.notEqual(canonicalEmployeeId("15473"), canonicalEmployeeId("15474"));
    assert.notEqual(canonicalEmployeeId("015473"), canonicalEmployeeId("150473"));
  });

  test("survives an id that is all zeros", () => {
    /* Stripping everything would make every such id equal to the empty
       string, and therefore equal to each other. */
    assert.equal(canonicalEmployeeId("0"), "0");
    assert.equal(canonicalEmployeeId("000"), "000");
    assert.notEqual(canonicalEmployeeId("000"), canonicalEmployeeId("0000"));
  });

  test("trims surrounding whitespace", () => {
    assert.equal(canonicalEmployeeId("  015473  "), canonicalEmployeeId("15473"));
  });

  test("is case-insensitive for alphanumeric ids", () => {
    assert.equal(canonicalEmployeeId("Emp001"), canonicalEmployeeId("EMP001"));
  });
});
