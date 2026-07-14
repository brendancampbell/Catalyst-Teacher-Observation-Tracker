/**
 * End-to-end integration tests for the Action Steps flow.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/test-action-steps-e2e.ts
 *
 * Requires the dev server to be running (NODE_ENV=development).
 *
 * Checkpoints covered:
 *   1.  POST /api/observations with newActionStep → observation + step created
 *   2.  GET /api/action-steps?teacherEmployeeId=X → step linked to observation
 *         (assignedDuringObservationId matches); step is open, text matches
 *         This is the data source for the ObservationDetailModal read-only display.
 *   3.  GET /api/action-steps?teacherEmployeeId=X → step appears in Open list
 *   4.  GET /api/action-steps/overdue → step appears (after backdating due date)
 *   5.  PATCH /api/action-steps/:id/master → step moves to mastered status
 *   6.  GET /api/action-steps?teacherEmployeeId=X → step now shows status "mastered"
 *   7.  GET /api/action-steps/overdue → mastered step no longer appears
 *   8.  POST /api/observations with masterActionStepId → step transitions to "mastered"
 *   9.  POST /api/observations without masterActionStepId → step status unchanged ("open")
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  observations,
  people,
  schools,
  rubricSets,
  actionSteps,
} from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── Employee IDs used by test fixtures ─────────────────────────── */
const ADMIN_EID   = "U10"; /* Brendan Campbell — NETWORK_ADMIN (already in DB) */
const TEACHER_EID = "TST_AS_E2E_TCH";
const LEADER_EID  = "TST_AS_E2E_SL";

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

/* ── Test state ─────────────────────────────────────────────────── */

let adminJar: Jar;
let leaderJar: Jar;
let createdObsId: number;
let createdStepId: number;
let testSchoolId: number;
let rubricSetId: number;
const ACTION_STEP_TEXT =
  "E2E: Practice naming students before posing questions to increase cold-call engagement";

/* State for mark-mastered integration tests (checkpoints 8 & 9) */
let masterTestStepId: number;          /* step submitted with markMastered=true  */
let masterTestObsId: number;           /* observation that carries masterActionStepId */
let noMasterTestStepId: number;        /* step submitted WITHOUT markMastered     */
let noMasterTestObsId: number;         /* observation with no masterActionStepId  */

describe("Action Steps — end-to-end flow", () => {
  before(async () => {
    /* Resolve an existing school and rubric set to attach test data to */
    const [firstSchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(1);
    assert.ok(firstSchool, "Need at least 1 school in the DB");
    testSchoolId = firstSchool.id;

    const [firstRubric] = await db
      .select({ id: rubricSets.id })
      .from(rubricSets)
      .orderBy(asc(rubricSets.id))
      .limit(1);
    assert.ok(firstRubric, "Need at least 1 rubric set in the DB");
    rubricSetId = firstRubric.id;

    /* Create a test teacher and school leader with the chosen school */
    await db.insert(people).values([
      {
        employeeId: TEACHER_EID,
        firstName: "E2E",
        lastName: "Teacher",
        email: "e2e.teacher@test.example.com",
        role: "NO_ACCESS",
        schoolId: testSchoolId,
        isActive: true,
        includeInFeedbackTracker: true,
      },
      {
        employeeId: LEADER_EID,
        firstName: "E2E",
        lastName: "Leader",
        email: "e2e.leader@test.example.com",
        role: "SCHOOL_LEADER",
        schoolId: testSchoolId,
        isActive: true,
        includeInFeedbackTracker: false,
      },
    ]).onConflictDoNothing();

    adminJar  = await loginAs(ADMIN_EID);
    leaderJar = await loginAs(LEADER_EID);
  });

  after(async () => {
    /* Clean up in dependency order: action steps → observations → people */
    if (createdStepId) {
      await db.delete(actionSteps).where(eq(actionSteps.id, createdStepId)).catch(() => {});
    }
    if (masterTestStepId) {
      await db.delete(actionSteps).where(eq(actionSteps.id, masterTestStepId)).catch(() => {});
    }
    if (noMasterTestStepId) {
      await db.delete(actionSteps).where(eq(actionSteps.id, noMasterTestStepId)).catch(() => {});
    }
    if (createdObsId) {
      await db.delete(observations).where(eq(observations.id, createdObsId)).catch(() => {});
    }
    if (masterTestObsId) {
      await db.delete(observations).where(eq(observations.id, masterTestObsId)).catch(() => {});
    }
    if (noMasterTestObsId) {
      await db.delete(observations).where(eq(observations.id, noMasterTestObsId)).catch(() => {});
    }
    await db
      .delete(people)
      .where(inArray(people.employeeId, [TEACHER_EID, LEADER_EID]))
      .catch(() => {});
  });

  /* ── Checkpoint 1 ────────────────────────────────────────────────
     POST /api/observations with newActionStep creates both records  */
  test("1 — POST /observations with newActionStep creates the observation and action step", async () => {
    const res = await request("POST", "/observations", {
      teacherId:     TEACHER_EID,
      rubricSetId:   rubricSetId,
      date:          "2026-07-13",
      time:          "09:00",
      course:        "E2E Action Step Test",
      scores:        {},
      strengths:     "Strong pacing",
      growthAreas:   "Cold-calling technique",
      observer:      "E2E Test Suite",
      isWalkthrough: false,
      status:        "published",
      newActionStep: {
        text:    ACTION_STEP_TEXT,
        dueDate: "2027-06-01",
      },
    }, adminJar);

    assert.ok(
      res.status === 200 || res.status === 201,
      `Expected 200 or 201, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const body = res.body as { id?: string | number };
    assert.ok(body.id, "Response should include id");
    createdObsId = Number(body.id);
  });

  /* ── Checkpoint 2 ────────────────────────────────────────────────
     The action step is linked to the observation and displayed as
     read-only data (ObservationDetailModal data source check).      */
  test("2 — GET /action-steps links the step to the observation (ObservationDetailModal data source)", async () => {
    assert.ok(createdObsId, "Observation must exist from checkpoint 1");

    const res = await request(
      "GET",
      `/action-steps?teacherEmployeeId=${TEACHER_EID}`,
      undefined,
      adminJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    const steps = res.body as Array<{
      id: number;
      text: string;
      status: string;
      assignedDuringObservationId?: number;
    }>;
    assert.ok(Array.isArray(steps) && steps.length > 0, "Should return at least one action step");

    const linked = steps.find((s) => s.assignedDuringObservationId === createdObsId);
    assert.ok(
      linked,
      `Expected a step with assignedDuringObservationId=${createdObsId}, got: ${JSON.stringify(steps.map((s) => s.assignedDuringObservationId))}`,
    );
    assert.equal(linked.text, ACTION_STEP_TEXT, "Step text should match what was submitted");
    assert.equal(linked.status, "open", "Newly created step should have status 'open'");

    createdStepId = linked.id;
  });

  /* ── Checkpoint 3 ────────────────────────────────────────────────
     Step appears in teacher profile Open list (same endpoint,
     verifying the step is filterable by status for the UI).         */
  test("3 — Teacher profile Open list contains the new step", async () => {
    assert.ok(createdStepId, "Step ID must exist from checkpoint 2");

    const res = await request(
      "GET",
      `/action-steps?teacherEmployeeId=${TEACHER_EID}`,
      undefined,
      leaderJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    const steps = res.body as Array<{ id: number; status: string }>;
    const theStep = steps.find((s) => s.id === createdStepId);
    assert.ok(theStep, `Step ${createdStepId} should appear in teacher's action step list`);
    assert.equal(theStep.status, "open", "Step should be in 'open' state");
  });

  /* ── Checkpoint 4 ────────────────────────────────────────────────
     Action Center Overdue tab shows the step after backdating.
     The API rejects past due dates on create/edit, so we backdate
     directly in the database — matching how the Playwright agent
     does it via a [DB] step.                                        */
  test("4 — Action Center Overdue tab shows the step when it is past due", async () => {
    assert.ok(createdStepId, "Step ID must exist from checkpoint 2");

    /* Backdate the due date so the step is overdue */
    await db
      .update(actionSteps)
      .set({ dueDate: "2026-01-15" })
      .where(eq(actionSteps.id, createdStepId));

    const res = await request("GET", "/action-steps/overdue", undefined, adminJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    const list = res.body as Array<{ id: number }>;
    const found = list.some((s) => s.id === createdStepId);
    assert.ok(
      found,
      `Overdue step ${createdStepId} should appear in the overdue list; got ids: ${JSON.stringify(list.map((s) => s.id))}`,
    );
  });

  /* ── Checkpoint 5 ────────────────────────────────────────────────
     Mark the step mastered via PATCH /action-steps/:id/master      */
  test("5 — PATCH /action-steps/:id/master marks the step as mastered", async () => {
    assert.ok(createdStepId, "Step ID must exist from checkpoint 2");

    const res = await request(
      "PATCH",
      `/action-steps/${createdStepId}/master`,
      undefined,
      adminJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    const body = res.body as { ok?: boolean; actionStep?: { status: string } };
    assert.equal(body.ok, true, "Response should indicate ok: true");
    assert.equal(body.actionStep?.status, "mastered", "Step status should now be 'mastered'");
  });

  /* ── Checkpoint 6 ────────────────────────────────────────────────
     GET /action-steps now shows the step as mastered (Mastered list) */
  test("6 — GET /action-steps shows the step in mastered status", async () => {
    assert.ok(createdStepId, "Step ID must exist from checkpoint 2");

    const res = await request(
      "GET",
      `/action-steps?teacherEmployeeId=${TEACHER_EID}`,
      undefined,
      adminJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    const steps = res.body as Array<{ id: number; status: string; masteredAt?: string }>;
    const theStep = steps.find((s) => s.id === createdStepId);
    assert.ok(theStep, `Step ${createdStepId} should still appear in action step list`);
    assert.equal(theStep.status, "mastered", "Step should now have status 'mastered'");
    assert.ok(theStep.masteredAt, "masteredAt timestamp should be set");
  });

  /* ── Checkpoint 7 ────────────────────────────────────────────────
     Action Center Overdue no longer includes the mastered step      */
  test("7 — Action Center Overdue tab hides the step after it is mastered", async () => {
    assert.ok(createdStepId, "Step ID must exist from checkpoint 2");

    const res = await request("GET", "/action-steps/overdue", undefined, adminJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    const list = res.body as Array<{ id: number }>;
    const stillPresent = list.some((s) => s.id === createdStepId);
    assert.ok(
      !stillPresent,
      `Mastered step ${createdStepId} should NOT appear in the overdue list`,
    );
  });

  /* ── Checkpoint 8 ────────────────────────────────────────────────
     POST /observations with masterActionStepId records mastery.
     Mirrors the 'Mark as Mastered' button path in the form:
     the UI sends masterActionStepId on submit, the server must
     transition that step to status="mastered" inside the transaction. */
  test("8 — POST /observations with masterActionStepId transitions the step to mastered", async () => {
    /* Seed a fresh open action step directly in the DB.
       (Mirrors how test 4 backdates via DB — fastest and cleanest.)  */
    const [seededStep] = await db.insert(actionSteps).values({
      teacherEmployeeId:    TEACHER_EID,
      assignedByEmployeeId: ADMIN_EID,
      text:                 "E2E CP8: Step that should be marked mastered via observation submit",
      dueDate:              "2027-12-31",
      status:               "open",
    }).returning();
    assert.ok(seededStep, "Should have inserted a test action step");
    masterTestStepId = seededStep.id;

    /* POST a new observation carrying masterActionStepId */
    const res = await request("POST", "/observations", {
      teacherId:           TEACHER_EID,
      rubricSetId:         rubricSetId,
      date:                "2026-07-14",
      time:                "10:00",
      course:              "E2E Mark Mastered Test",
      scores:              {},
      strengths:           "Good energy",
      growthAreas:         "Transitions",
      observer:            "E2E Test Suite",
      isWalkthrough:       false,
      status:              "published",
      masterActionStepId:  masterTestStepId,
    }, adminJar);

    assert.ok(
      res.status === 200 || res.status === 201,
      `Expected 200 or 201, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const body = res.body as { id?: string | number };
    assert.ok(body.id, "Response should include id");
    masterTestObsId = Number(body.id);

    /* Confirm the action step row is now mastered in the DB */
    const step = await db.query.actionSteps.findFirst({
      where: eq(actionSteps.id, masterTestStepId),
    });
    assert.ok(step, "Action step should still exist");
    assert.equal(
      step.status,
      "mastered",
      `Expected step status 'mastered', got '${step.status}'`,
    );
    assert.ok(step.masteredAt, "masteredAt should be set after mastering");
    assert.equal(
      step.masteredByEmployeeId,
      ADMIN_EID,
      "masteredByEmployeeId should be the submitting admin",
    );
    assert.equal(
      step.masteredDuringObservationId,
      masterTestObsId,
      "masteredDuringObservationId should reference the new observation",
    );
  });

  /* ── Checkpoint 9 ────────────────────────────────────────────────
     POST /observations WITHOUT masterActionStepId leaves the step
     untouched — i.e. markMastered=false (the default) must not
     accidentally flip any step to mastered.                          */
  test("9 — POST /observations without masterActionStepId leaves step status unchanged", async () => {
    /* Seed another open action step */
    const [seededStep] = await db.insert(actionSteps).values({
      teacherEmployeeId:    TEACHER_EID,
      assignedByEmployeeId: ADMIN_EID,
      text:                 "E2E CP9: Step that should remain open (no markMastered)",
      dueDate:              "2027-12-31",
      status:               "open",
    }).returning();
    assert.ok(seededStep, "Should have inserted a test action step");
    noMasterTestStepId = seededStep.id;

    /* POST a new observation with NO masterActionStepId */
    const res = await request("POST", "/observations", {
      teacherId:     TEACHER_EID,
      rubricSetId:   rubricSetId,
      date:          "2026-07-14",
      time:          "11:00",
      course:        "E2E No Mark Mastered Test",
      scores:        {},
      strengths:     "Consistent routines",
      growthAreas:   "Wait time",
      observer:      "E2E Test Suite",
      isWalkthrough: false,
      status:        "published",
    }, adminJar);

    assert.ok(
      res.status === 200 || res.status === 201,
      `Expected 200 or 201, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const body = res.body as { id?: string | number };
    assert.ok(body.id, "Response should include id");
    noMasterTestObsId = Number(body.id);

    /* Confirm the seeded step is still open — not accidentally mastered */
    const step = await db.query.actionSteps.findFirst({
      where: eq(actionSteps.id, noMasterTestStepId),
    });
    assert.ok(step, "Action step should still exist");
    assert.equal(
      step.status,
      "open",
      `Expected step status 'open' (unchanged), got '${step.status}'`,
    );
    assert.equal(
      step.masteredAt,
      null,
      "masteredAt should remain null when masterActionStepId was not sent",
    );
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
