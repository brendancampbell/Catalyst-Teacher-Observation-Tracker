/**
 * Unit tests for buildOverdueActionStepsSummary.
 *
 * These are pure-function tests — no database or server required.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:overdue-action-steps
 *
 * Covers:
 *  1. No steps at all         → empty string
 *  2. Steps exist but none overdue (future due dates or wrong status) → empty string
 *  3. Mastered steps          → excluded even if due date is in the past
 *  4. Open overdue steps      → correct Markdown with teacher name + step details
 *  5. Multiple teachers       → all appear; count in header is correct
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildOverdueActionStepsSummary } from "./routes/ai.js";
import type { ActionStepEntry } from "./services/ai-service.js";

const TODAY = "2026-07-15";

function makeStep(overrides: Partial<ActionStepEntry> = {}): ActionStepEntry {
  return {
    text:       "Work on questioning strategies",
    dueDate:    "2026-08-01",   // future — not overdue by default
    status:     "open",
    masteredAt: null,
    createdAt:  new Date("2026-06-01"),
    ...overrides,
  };
}

describe("buildOverdueActionStepsSummary", () => {
  test("returns empty string when actionStepsMap is empty", () => {
    const result = buildOverdueActionStepsSummary(new Map(), new Map(), TODAY);
    assert.equal(result, "");
  });

  test("returns empty string when all steps have future due dates", () => {
    const map = new Map<string, ActionStepEntry[]>([
      ["emp1", [makeStep({ dueDate: "2026-08-01" })]],
    ]);
    const names = new Map([["emp1", "Alice Smith"]]);
    const result = buildOverdueActionStepsSummary(map, names, TODAY);
    assert.equal(result, "");
  });

  test("returns empty string when all open steps have today's due date (not yet overdue)", () => {
    const map = new Map<string, ActionStepEntry[]>([
      ["emp1", [makeStep({ dueDate: TODAY })]],
    ]);
    const names = new Map([["emp1", "Alice Smith"]]);
    const result = buildOverdueActionStepsSummary(map, names, TODAY);
    assert.equal(result, "");
  });

  test("excludes mastered steps even if the due date is in the past", () => {
    const map = new Map<string, ActionStepEntry[]>([
      ["emp1", [makeStep({ dueDate: "2026-06-01", status: "mastered", masteredAt: new Date("2026-05-20") })]],
    ]);
    const names = new Map([["emp1", "Alice Smith"]]);
    const result = buildOverdueActionStepsSummary(map, names, TODAY);
    assert.equal(result, "");
  });

  test("excludes non-open statuses (e.g. 'closed') even if due date is in the past", () => {
    const map = new Map<string, ActionStepEntry[]>([
      ["emp1", [makeStep({ dueDate: "2026-06-01", status: "closed" })]],
    ]);
    const names = new Map([["emp1", "Alice Smith"]]);
    const result = buildOverdueActionStepsSummary(map, names, TODAY);
    assert.equal(result, "");
  });

  test("includes open steps whose due date is before today", () => {
    const stepText = "Improve wait time after questioning";
    const dueDate  = "2026-06-30";
    const map = new Map<string, ActionStepEntry[]>([
      ["emp1", [makeStep({ text: stepText, dueDate, status: "open" })]],
    ]);
    const names = new Map([["emp1", "Bob Jones"]]);
    const result = buildOverdueActionStepsSummary(map, names, TODAY);

    assert.match(result, /## Overdue action steps/);
    assert.match(result, /1 teacher\(s\) have open action steps past their due date/);
    assert.match(result, /Bob Jones/);
    assert.match(result, new RegExp(stepText));
    assert.match(result, new RegExp(`due ${dueDate}`));
  });

  test("mixes overdue and non-overdue steps for the same teacher — only overdue appear", () => {
    const overdueStep = makeStep({ text: "OVERDUE_STEP", dueDate: "2026-05-01", status: "open" });
    const futureStep  = makeStep({ text: "FUTURE_STEP",  dueDate: "2026-09-01", status: "open" });
    const masteredStep = makeStep({ text: "MASTERED_STEP", dueDate: "2026-04-01", status: "mastered", masteredAt: new Date() });

    const map = new Map<string, ActionStepEntry[]>([
      ["emp1", [overdueStep, futureStep, masteredStep]],
    ]);
    const names = new Map([["emp1", "Carol Rivera"]]);
    const result = buildOverdueActionStepsSummary(map, names, TODAY);

    assert.match(result, /OVERDUE_STEP/);
    assert.doesNotMatch(result, /FUTURE_STEP/);
    assert.doesNotMatch(result, /MASTERED_STEP/);
  });

  test("handles multiple teachers — count in header and all names appear", () => {
    const map = new Map<string, ActionStepEntry[]>([
      ["emp1", [makeStep({ text: "Step for Teacher1", dueDate: "2026-06-01", status: "open" })]],
      ["emp2", [makeStep({ text: "Step for Teacher2", dueDate: "2026-06-15", status: "open" })]],
    ]);
    const names = new Map([
      ["emp1", "Diana Prince"],
      ["emp2", "Ethan Cross"],
    ]);
    const result = buildOverdueActionStepsSummary(map, names, TODAY);

    assert.match(result, /2 teacher\(s\) have open action steps past their due date/);
    assert.match(result, /Diana Prince/);
    assert.match(result, /Ethan Cross/);
    assert.match(result, /Step for Teacher1/);
    assert.match(result, /Step for Teacher2/);
  });

  test("falls back to employeeId when teacher name is missing from nameMap", () => {
    const map = new Map<string, ActionStepEntry[]>([
      ["emp-unknown", [makeStep({ dueDate: "2026-06-01", status: "open" })]],
    ]);
    const names = new Map<string, string>();  // no entry for emp-unknown
    const result = buildOverdueActionStepsSummary(map, names, TODAY);

    assert.match(result, /emp-unknown/);
  });
});
