/**
 * Regression test: PATCH /api/action-steps/:id/master and PATCH /api/action-steps/:id
 * must reject action steps that belong to a prior (inactive) school year with 404,
 * even when the caller has valid school-level access to the teacher.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:action-step-school-year-scope
 *
 * Requires the dev server to be running (NODE_ENV=development).
 *
 * Scenarios:
 *   a. PATCH /master on a prior-year step → 404 (not 200 or 403)
 *   b. PATCH /:id   on a prior-year step → 404 (not 200 or 403)
 *   c. PATCH /master on a current-year step → 200  (positive control)
 *   d. PATCH /:id   on a current-year step → 200  (positive control)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  actionSteps,
  people,
  schools,
  schoolYears,
} from "@workspace/db/schema";
import { eq, ne, asc, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const COACH_EID   = "TST_ASSR_COACH";
const TEACHER_EID = "TST_ASSR_TCH";

/* ── HTTP helpers ─────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function request(
  method: string,
  path: string,
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar.cookieHeader) headers["Cookie"] = jar.cookieHeader;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let responseBody: unknown;
  try { responseBody = await res.json(); } catch { responseBody = null; }
  return { status: res.status, body: responseBody };
}

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  const setCookie = res.headers.get("set-cookie");
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: status ${res.status}`);
  assert.ok(setCookie, "dev-login should return a Set-Cookie header");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

/* ── Test state ───────────────────────────────────────────────────── */

let coachJar: Jar;
let testSchoolId: number;
let activeYearId: number;
let priorYearId: number;
let priorYearStepId: number;    // action step in prior (inactive) school year
let currentYearStepId: number;  // action step in current (active) school year

/* ── Suite ────────────────────────────────────────────────────────── */

describe("Action-step PATCH handlers — school-year scope guard", () => {
  before(async () => {
    /* Find a school to use */
    const [firstSchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(1);
    assert.ok(firstSchool, "Need at least 1 school in the DB");
    testSchoolId = firstSchool.id;

    /* Find the active year and a prior (inactive) year */
    const [activeYear] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);
    assert.ok(activeYear, "Need an active school year in the DB");
    activeYearId = activeYear.id;

    const [priorYear] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(ne(schoolYears.id, activeYearId))
      .orderBy(asc(schoolYears.id))
      .limit(1);
    assert.ok(priorYear, "Need at least one inactive school year in the DB for this test");
    priorYearId = priorYear.id;

    /* Seed a COACH and a teacher in the same school */
    await db.insert(people).values([
      {
        employeeId: COACH_EID,
        firstName:  "TestCoach",
        lastName:   "ASSR",
        email:      "test.coach.assr@test.example.com",
        role:       "COACH",
        schoolId:   testSchoolId,
        isActive:   true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId: TEACHER_EID,
        firstName:  "TestTeacher",
        lastName:   "ASSR",
        email:      "test.teacher.assr@test.example.com",
        role:       "NO_ACCESS",
        schoolId:   testSchoolId,
        isActive:   true,
        includeInFeedbackTracker: true,
      },
    ]).onConflictDoNothing();

    /* Seed an action step in the prior (inactive) school year */
    const [priorStep] = await db.insert(actionSteps).values({
      schoolYearId:         priorYearId,
      teacherEmployeeId:    TEACHER_EID,
      assignedByEmployeeId: COACH_EID,
      text:                 "ASSR-TEST: prior-year step (should be immutable via PATCH)",
      dueDate:              "2027-12-31",
      status:               "open",
    }).returning();
    assert.ok(priorStep, "Should have inserted prior-year action step");
    priorYearStepId = priorStep.id;

    /* Seed an action step in the current (active) school year */
    const [currentStep] = await db.insert(actionSteps).values({
      schoolYearId:         activeYearId,
      teacherEmployeeId:    TEACHER_EID,
      assignedByEmployeeId: COACH_EID,
      text:                 "ASSR-TEST: current-year step (PATCH should succeed)",
      dueDate:              "2027-12-31",
      status:               "open",
    }).returning();
    assert.ok(currentStep, "Should have inserted current-year action step");
    currentYearStepId = currentStep.id;

    coachJar = await loginAs(COACH_EID);
  });

  after(async () => {
    const stepIds = [priorYearStepId, currentYearStepId].filter(Boolean);
    if (stepIds.length > 0) {
      await db.delete(actionSteps).where(inArray(actionSteps.id, stepIds)).catch(() => {});
    }
    await db
      .delete(people)
      .where(inArray(people.employeeId, [COACH_EID, TEACHER_EID]))
      .catch(() => {});
  });

  /* ── a ────────────────────────────────────────────────────────────
     PATCH /master on a prior-year step must return 404, not 200.
     The coach has legitimate school-level access to the teacher, so
     the year check (not the school check) is what must fire.         */
  test("a — PATCH /master on a prior-year step → 404", async () => {
    const res = await request(
      "PATCH",
      `/action-steps/${priorYearStepId}/master`,
      {},
      coachJar,
    );
    assert.equal(
      res.status,
      404,
      `Expected 404 for prior-year step mastery, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    /* Confirm the step was NOT mutated in the DB */
    const step = await db.query.actionSteps.findFirst({
      where: eq(actionSteps.id, priorYearStepId),
    });
    assert.ok(step, "Prior-year step should still exist in DB");
    assert.equal(step.status, "open", "Prior-year step must remain 'open' after rejected PATCH");
    assert.equal(step.masteredAt, null, "masteredAt must remain null");
  });

  /* ── b ────────────────────────────────────────────────────────────
     PATCH /:id (text/dueDate edit) on a prior-year step → 404.      */
  test("b — PATCH /:id edit on a prior-year step → 404", async () => {
    const res = await request(
      "PATCH",
      `/action-steps/${priorYearStepId}`,
      { text: "Attempted edit of prior-year step" },
      coachJar,
    );
    assert.equal(
      res.status,
      404,
      `Expected 404 for prior-year step edit, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    /* Confirm the step text was NOT changed */
    const step = await db.query.actionSteps.findFirst({
      where: eq(actionSteps.id, priorYearStepId),
    });
    assert.ok(step, "Prior-year step should still exist");
    assert.ok(
      !step.text.includes("Attempted edit"),
      `Step text must not have changed: "${step.text}"`,
    );
  });

  /* ── c ────────────────────────────────────────────────────────────
     Positive control: PATCH /master on a current-year step → 200.   */
  test("c — PATCH /master on a current-year step → 200", async () => {
    const res = await request(
      "PATCH",
      `/action-steps/${currentYearStepId}/master`,
      {},
      coachJar,
    );
    assert.equal(
      res.status,
      200,
      `Expected 200 for current-year step mastery, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const step = await db.query.actionSteps.findFirst({
      where: eq(actionSteps.id, currentYearStepId),
    });
    assert.ok(step, "Current-year step should still exist");
    assert.equal(step.status, "mastered", "Step should be mastered after successful PATCH");
  });

  /* ── d ────────────────────────────────────────────────────────────
     Positive control: PATCH /:id on a current-year step → 200.
     (We seed a fresh open step since c mastered the original one.)   */
  test("d — PATCH /:id edit on a current-year step → 200", async () => {
    /* Seed a fresh step for this test (the one from before() is now mastered) */
    const [freshStep] = await db.insert(actionSteps).values({
      schoolYearId:         activeYearId,
      teacherEmployeeId:    TEACHER_EID,
      assignedByEmployeeId: COACH_EID,
      text:                 "ASSR-TEST-D: current-year step to edit",
      dueDate:              "2027-12-31",
      status:               "open",
    }).returning();
    assert.ok(freshStep, "Should have inserted fresh current-year step for test d");

    try {
      const res = await request(
        "PATCH",
        `/action-steps/${freshStep.id}`,
        { text: "Updated by test d" },
        coachJar,
      );
      assert.equal(
        res.status,
        200,
        `Expected 200 for current-year step edit, got ${res.status}: ${JSON.stringify(res.body)}`,
      );

      const step = await db.query.actionSteps.findFirst({
        where: eq(actionSteps.id, freshStep.id),
      });
      assert.ok(step, "Step should still exist after edit");
      assert.equal(step.text, "Updated by test d", "Step text must be updated");
    } finally {
      await db.delete(actionSteps).where(eq(actionSteps.id, freshStep.id)).catch(() => {});
    }
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
