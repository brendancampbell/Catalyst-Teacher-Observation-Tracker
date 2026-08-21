/**
 * Unit tests for extending an action step (backlog #16).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-action-step-extension.ts
 *
 * No database. These guard the rules that decide whether a due date may be
 * moved at all — the ones POST /observations and PUT /observations/:id both
 * depend on, which is why they live in one module rather than being written
 * twice.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateExtensionRequest,
  checkStepIsExtendable,
  MAX_EXTENSION_NOTE,
} from "./lib/action-step-extension.js";

const TODAY = "2026-08-21";
const ok    = { actionStepId: 7, newDueDate: "2026-09-04" };

describe("validateExtensionRequest", () => {
  test("accepts a well-formed extension", () => {
    assert.equal(validateExtensionRequest(ok, false, TODAY).ok, true);
    assert.equal(validateExtensionRequest({ ...ok, note: "out sick" }, false, TODAY).ok, true);
  });

  test("does nothing when no extension was asked for", () => {
    assert.equal(validateExtensionRequest(undefined, true, TODAY).ok, true);
    assert.equal(validateExtensionRequest(null, false, TODAY).ok, true);
  });

  test("refuses to extend AND assign in the same observation", () => {
    /* The rule this feature turns on. Extending and assigning are two
       different answers to "what next for this teacher", and doing both is
       how you end up back with two open steps. */
    const v = validateExtensionRequest(ok, true, TODAY);
    assert.equal(v.ok, false);
    assert.match(v.ok === false ? v.error : "", /either extend .* or assign a new one/i);
  });

  test("rejects a due date in the past", () => {
    /* Matters more here than for a new step: the reason to extend is that the
       old date has passed, so an interface prefilling the old date — which is
       what the button used to do — failed this every time. */
    const v = validateExtensionRequest({ ...ok, newDueDate: "2026-08-20" }, false, TODAY);
    assert.equal(v.ok, false);
    assert.match(v.ok === false ? v.error : "", /today or in the future/);
  });

  test("accepts today itself", () => {
    assert.equal(validateExtensionRequest({ ...ok, newDueDate: TODAY }, false, TODAY).ok, true);
  });

  test("rejects a malformed date", () => {
    for (const bad of ["not-a-date", "2026-8-4", "04/09/2026", "", 20260904]) {
      assert.equal(validateExtensionRequest({ ...ok, newDueDate: bad }, false, TODAY).ok, false, String(bad));
    }
  });

  test("rejects a missing or nonsense action step id", () => {
    for (const bad of [undefined, null, 0, -1, 1.5, "7"]) {
      assert.equal(validateExtensionRequest({ ...ok, actionStepId: bad }, false, TODAY).ok, false, String(bad));
    }
  });

  test("rejects a note that is not a string, or too long", () => {
    assert.equal(validateExtensionRequest({ ...ok, note: 42 }, false, TODAY).ok, false);
    const tooLong = "x".repeat(MAX_EXTENSION_NOTE + 1);
    assert.equal(validateExtensionRequest({ ...ok, note: tooLong }, false, TODAY).ok, false);
    assert.equal(validateExtensionRequest({ ...ok, note: "x".repeat(MAX_EXTENSION_NOTE) }, false, TODAY).ok, true);
  });
});

describe("checkStepIsExtendable", () => {
  const step = { teacherEmployeeId: "T1", status: "open" };

  test("accepts an open step belonging to the observed teacher", () => {
    assert.equal(checkStepIsExtendable(step, "T1").ok, true);
  });

  test("rejects a step that does not exist", () => {
    assert.equal(checkStepIsExtendable(null, "T1").ok, false);
    assert.equal(checkStepIsExtendable(undefined, "T1").ok, false);
  });

  test("rejects a step belonging to a different teacher", () => {
    /* Otherwise an observation of one teacher could move another teacher's
       deadline. */
    const v = checkStepIsExtendable(step, "T2");
    assert.equal(v.ok, false);
    assert.match(v.ok === false ? v.error : "", /different teacher/i);
  });

  test("rejects an observation with no observed teacher at all", () => {
    /* School-target observations have no teacher, so there is nothing to
       extend against. */
    assert.equal(checkStepIsExtendable(step, null).ok, false);
    assert.equal(checkStepIsExtendable(step, undefined).ok, false);
  });

  test("rejects a mastered step", () => {
    /* Extending finished work would reopen it. Mastered means done. */
    const v = checkStepIsExtendable({ ...step, status: "mastered" }, "T1");
    assert.equal(v.ok, false);
    assert.match(v.ok === false ? v.error : "", /open action step/i);
  });
});
