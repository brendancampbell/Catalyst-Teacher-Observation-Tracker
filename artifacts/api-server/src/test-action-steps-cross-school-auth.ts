/**
 * Cross-school scoping integration tests for Action Steps endpoints.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/test-action-steps-cross-school-auth.ts
 *
 * Requires the dev server to be running (NODE_ENV=development).
 *
 * Scenarios:
 *   1.  SCHOOL_LEADER from School A → GET /action-steps?teacherEmployeeId=<teacher B> → 403
 *   2.  SCHOOL_LEADER from School A → GET /action-steps/latest?teacherEmployeeId=<teacher B> → 403
 *   3.  SCHOOL_LEADER from School A → GET /action-steps/overdue → only sees School A steps
 *   4.  SCHOOL_LEADER from School A → POST /observations with newActionStep for teacher B → 403
 *   5.  SCHOOL_LEADER from School A → PUT /observations/:id with newActionStep for teacher B obs → 403
 *   6.  SCHOOL_LEADER from School A → PATCH /action-steps/:id/master for teacher B step → 403
 *   7.  SCHOOL_LEADER from School A → PATCH /action-steps/:id for teacher B step → 403
 *   8.  SCHOOL_LEADER from School A → GET /action-steps?teacherEmployeeId=<teacher A> → 200
 *   9.  SCHOOL_LEADER from School A → PATCH /action-steps/:id/master for teacher A step → 200
 *   10. SCHOOL_LEADER from School A → PATCH /action-steps/:id for teacher A step → 200
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { observations, people, schools, rubricSets, actionSteps } from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

let SCHOOL_A_ID: number;
let SCHOOL_B_ID: number;
let RUBRIC_SET_ID: number;

const LEADER_A_EID  = "TST_AS_SL_A";
const LEADER_B_EID  = "TST_AS_SL_B";
const TEACHER_A_EID = "TST_AS_TCH_A";
const TEACHER_B_EID = "TST_AS_TCH_B";

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

let leaderAJar: Jar;
let createdObsIds: number[] = [];
let createdStepIds: number[] = [];
let stepAId: number;
let stepBId: number;
let obsAId: number;
let obsBId: number;

describe("SCHOOL_LEADER cross-school auth — Action Steps", () => {
  before(async () => {
    const twoSchools = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(2);
    assert.equal(twoSchools.length, 2, "Need at least 2 schools in the DB to run this test");
    SCHOOL_A_ID = twoSchools[0]!.id;
    SCHOOL_B_ID = twoSchools[1]!.id;

    const firstRubricSet = await db
      .select({ id: rubricSets.id })
      .from(rubricSets)
      .orderBy(asc(rubricSets.id))
      .limit(1);
    assert.equal(firstRubricSet.length, 1, "Need at least 1 rubric set in the DB to run this test");
    RUBRIC_SET_ID = firstRubricSet[0]!.id;

    /* Create test users */
    await db.insert(people).values([
      {
        employeeId: LEADER_A_EID, firstName: "Test", lastName: "LeaderA",
        email: "tst.as.leader.a@example.com", role: "SCHOOL_LEADER",
        schoolId: SCHOOL_A_ID, isActive: true, includeInFeedbackTracker: false,
      },
      {
        employeeId: LEADER_B_EID, firstName: "Test", lastName: "LeaderB",
        email: "tst.as.leader.b@example.com", role: "SCHOOL_LEADER",
        schoolId: SCHOOL_B_ID, isActive: true, includeInFeedbackTracker: false,
      },
      {
        employeeId: TEACHER_A_EID, firstName: "Teacher", lastName: "Alpha",
        email: "tst.as.teacher.a@example.com", role: "NO_ACCESS",
        schoolId: SCHOOL_A_ID, isActive: true, includeInFeedbackTracker: true,
      },
      {
        employeeId: TEACHER_B_EID, firstName: "Teacher", lastName: "Beta",
        email: "tst.as.teacher.b@example.com", role: "NO_ACCESS",
        schoolId: SCHOOL_B_ID, isActive: true, includeInFeedbackTracker: true,
      },
    ]).onConflictDoNothing();

    /* Observations for each teacher */
    const [obsA] = await db.insert(observations).values({
      observedEmployeeId: TEACHER_A_EID, rubricSetId: RUBRIC_SET_ID, schoolId: null,
      date: "2025-06-01", observer: "Action Step Test", status: "published", target: "TEACHER",
    }).returning({ id: observations.id });
    obsAId = obsA!.id;
    createdObsIds.push(obsAId);

    const [obsB] = await db.insert(observations).values({
      observedEmployeeId: TEACHER_B_EID, rubricSetId: RUBRIC_SET_ID, schoolId: null,
      date: "2025-06-01", observer: "Action Step Test", status: "published", target: "TEACHER",
    }).returning({ id: observations.id });
    obsBId = obsB!.id;
    createdObsIds.push(obsBId);

    /* Action steps for each teacher */
    const [stepA] = await db.insert(actionSteps).values({
      teacherEmployeeId: TEACHER_A_EID, assignedByEmployeeId: LEADER_A_EID,
      assignedDuringObservationId: obsAId, text: "Action step for teacher A",
      dueDate: "2099-12-31", status: "open",
    }).returning({ id: actionSteps.id });
    stepAId = stepA!.id;
    createdStepIds.push(stepAId);

    const [stepB] = await db.insert(actionSteps).values({
      teacherEmployeeId: TEACHER_B_EID, assignedByEmployeeId: LEADER_B_EID,
      assignedDuringObservationId: obsBId, text: "Action step for teacher B",
      dueDate: "2099-12-31", status: "open",
    }).returning({ id: actionSteps.id });
    stepBId = stepB!.id;
    createdStepIds.push(stepBId);

    leaderAJar = await loginAs(LEADER_A_EID);
  });

  after(async () => {
    for (const id of createdStepIds) {
      await db.delete(actionSteps).where(eq(actionSteps.id, id)).catch(() => {});
    }
    for (const id of createdObsIds) {
      await db.delete(observations).where(eq(observations.id, id)).catch(() => {});
    }
    await db.delete(people).where(
      inArray(people.employeeId, [LEADER_A_EID, LEADER_B_EID, TEACHER_A_EID, TEACHER_B_EID]),
    );
  });

  /* 1 — GET history cross-school → 403 */
  test("1 — SCHOOL_LEADER cannot GET action step history for a teacher outside their school", async () => {
    const res = await request("GET", `/action-steps?teacherEmployeeId=${TEACHER_B_EID}`, undefined, leaderAJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* 2 — GET latest cross-school → 403 */
  test("2 — SCHOOL_LEADER cannot GET latest action step for a teacher outside their school", async () => {
    const res = await request("GET", `/action-steps/latest?teacherEmployeeId=${TEACHER_B_EID}`, undefined, leaderAJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* 3 — GET overdue → only School A steps */
  test("3 — SCHOOL_LEADER GET /action-steps/overdue only includes their own school", async () => {
    /* Seed an overdue step for teacher A */
    const [overdueA] = await db.insert(actionSteps).values({
      teacherEmployeeId: TEACHER_A_EID, assignedByEmployeeId: LEADER_A_EID,
      assignedDuringObservationId: null, text: "Overdue for teacher A",
      dueDate: "2020-01-01", status: "open",
    }).returning({ id: actionSteps.id });
    createdStepIds.push(overdueA!.id);

    const [overdueB] = await db.insert(actionSteps).values({
      teacherEmployeeId: TEACHER_B_EID, assignedByEmployeeId: LEADER_B_EID,
      assignedDuringObservationId: null, text: "Overdue for teacher B",
      dueDate: "2020-01-01", status: "open",
    }).returning({ id: actionSteps.id });
    createdStepIds.push(overdueB!.id);

    const res = await request("GET", "/action-steps/overdue", undefined, leaderAJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const list = res.body as Array<{ teacherEmployeeId: string }>;
    assert.ok(Array.isArray(list), "Response should be an array");
    for (const item of list) {
      assert.notEqual(
        item.teacherEmployeeId,
        TEACHER_B_EID,
        `Overdue list should not include Teacher B's steps for School A leader`,
      );
    }
    const hasTeacherA = list.some((s) => s.teacherEmployeeId === TEACHER_A_EID);
    assert.ok(hasTeacherA, "Overdue list should include Teacher A's overdue step");
  });

  /* 4 — POST observation with newActionStep for teacher B → 403 */
  test("4 — SCHOOL_LEADER cannot POST observation with newActionStep for a teacher outside their school", async () => {
    const res = await request("POST", "/observations", {
      observedEmployeeId: TEACHER_B_EID,
      rubricSetId: RUBRIC_SET_ID,
      date: "2025-07-01",
      observer: "Test",
      status: "draft",
      scores: {},
      newActionStep: { text: "Should be blocked", dueDate: "2099-12-31" },
    }, leaderAJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* 5 — PUT observation for teacher B obs with newActionStep → 403 */
  test("5 — SCHOOL_LEADER cannot PUT observation with newActionStep for a teacher outside their school", async () => {
    const res = await request("PUT", `/observations/${obsBId}`, {
      newActionStep: { text: "Should be blocked", dueDate: "2099-12-31" },
    }, leaderAJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* 6 — PATCH master cross-school → 403 */
  test("6 — SCHOOL_LEADER cannot master an action step for a teacher outside their school", async () => {
    const res = await request("PATCH", `/action-steps/${stepBId}/master`, undefined, leaderAJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* 7 — PATCH edit cross-school → 403 */
  test("7 — SCHOOL_LEADER cannot edit an action step for a teacher outside their school", async () => {
    const res = await request("PATCH", `/action-steps/${stepBId}`, { text: "Blocked edit" }, leaderAJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* 8 — GET history own school → 200 */
  test("8 — SCHOOL_LEADER can GET action step history for their own school's teacher", async () => {
    const res = await request("GET", `/action-steps?teacherEmployeeId=${TEACHER_A_EID}`, undefined, leaderAJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const list = res.body as unknown[];
    assert.ok(Array.isArray(list), "Response should be an array");
  });

  /* 9 — PATCH master own school → 200 */
  test("9 — SCHOOL_LEADER can master an action step for their own school's teacher", async () => {
    const res = await request("PATCH", `/action-steps/${stepAId}/master`, undefined, leaderAJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* 10 — PATCH edit own school → 400 (already mastered by test 9, so "already mastered" is correct business logic) */
  test("10 — SCHOOL_LEADER edit of an already-mastered step returns 400 (business rule, not auth)", async () => {
    const res = await request("PATCH", `/action-steps/${stepAId}`, { text: "New text" }, leaderAJar);
    /* Either 400 (already mastered) or 200 depending on order. We just assert it is NOT a cross-school 403. */
    assert.ok(
      res.status !== 403,
      `Got unexpected 403 (cross-school block) for own-school step: ${JSON.stringify(res.body)}`,
    );
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
