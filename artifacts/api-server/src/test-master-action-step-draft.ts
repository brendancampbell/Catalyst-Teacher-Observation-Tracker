/**
 * Regression test: masterActionStepId must not fire during draft autosave.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:master-action-step-draft
 *
 * Requires the dev server to be running (NODE_ENV=development).
 *
 * Scenarios:
 *   a. POST draft with masterActionStepId → step remains open (not mastered)
 *   b. PUT publish (draft→published) with masterActionStepId → step becomes
 *      mastered with correct masteredAt / masteredByEmployeeId /
 *      masteredDuringObservationId audit fields
 *   c. Three consecutive PUT draft autosaves carrying the same
 *      masterActionStepId → all return 200, step stays open after each
 *   d. Final PUT publish → step is mastered exactly once (no double-apply)
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

const ADMIN_EID   = "U10";                  /* Brendan Campbell — NETWORK_ADMIN */
const TEACHER_EID = "TST_MASTERDRAFT_TCH";
const LEADER_EID  = "TST_MASTERDRAFT_SL";

/* ── HTTP helpers ──────────────────────────────────────────────────────── */

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

/* ── Test state ────────────────────────────────────────────────────────── */

let adminJar: Jar;
let testSchoolId: number;
let rubricSetId: number;

/* Scenario a/b: draft POST then publish PUT */
let scenarioAbStepId: number;
let scenarioAbObsId: number;

/* Scenario c/d: three draft PUTs then final publish PUT */
let scenarioCdStepId: number;
let scenarioCdObsId: number;

/* ── Suite ─────────────────────────────────────────────────────────────── */

describe("masterActionStepId — draft autosave must not trigger mastery", () => {
  before(async () => {
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

    await db.insert(people).values([
      {
        employeeId: TEACHER_EID,
        firstName: "MasterDraft",
        lastName: "Teacher",
        email: "masterdraft.teacher@test.example.com",
        role: "NO_ACCESS",
        schoolId: testSchoolId,
        isActive: true,
        includeInFeedbackTracker: true,
      },
      {
        employeeId: LEADER_EID,
        firstName: "MasterDraft",
        lastName: "Leader",
        email: "masterdraft.leader@test.example.com",
        role: "SCHOOL_LEADER",
        schoolId: testSchoolId,
        isActive: true,
        includeInFeedbackTracker: false,
      },
    ]).onConflictDoNothing();

    adminJar = await loginAs(ADMIN_EID);
  });

  after(async () => {
    const stepIds = [scenarioAbStepId, scenarioCdStepId].filter(Boolean);
    if (stepIds.length > 0) {
      await db.delete(actionSteps).where(inArray(actionSteps.id, stepIds)).catch(() => {});
    }
    const obsIds = [scenarioAbObsId, scenarioCdObsId].filter(Boolean);
    for (const id of obsIds) {
      await db.delete(observations).where(eq(observations.id, id)).catch(() => {});
    }
    await db
      .delete(people)
      .where(inArray(people.employeeId, [TEACHER_EID, LEADER_EID]))
      .catch(() => {});
  });

  /* ── Scenario a ──────────────────────────────────────────────────────
     POST draft with masterActionStepId → step stays open.              */
  test("a — POST draft with masterActionStepId leaves the action step open", async () => {
    const [seededStep] = await db.insert(actionSteps).values({
      schoolYearId:         1,
      teacherEmployeeId:    TEACHER_EID,
      assignedByEmployeeId: ADMIN_EID,
      text:                 "MASTERDRAFT-A: should remain open after draft POST",
      dueDate:              "2027-12-31",
      status:               "open",
    }).returning();
    assert.ok(seededStep, "Should have inserted a test action step");
    scenarioAbStepId = seededStep.id;

    const res = await request("POST", "/observations", {
      teacherId:          TEACHER_EID,
      rubricSetId:        rubricSetId,
      date:               "2026-07-20",
      time:               "09:00",
      course:             "MasterDraft Test A",
      scores:             {},
      strengths:          "Good questioning",
      growthAreas:        "Wait time",
      isWalkthrough:      false,
      status:             "draft",
      masterActionStepId: scenarioAbStepId,
    }, adminJar);

    assert.ok(
      res.status === 200 || res.status === 201,
      `Draft POST expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const body = res.body as { id?: string | number };
    assert.ok(body.id, "Response should include id");
    scenarioAbObsId = Number(body.id);

    /* Step must still be open — mastery must NOT fire on a draft */
    const step = await db.query.actionSteps.findFirst({
      where: eq(actionSteps.id, scenarioAbStepId),
    });
    assert.ok(step, "Action step should still exist");
    assert.equal(
      step.status,
      "open",
      `Step should remain 'open' after draft POST, got '${step.status}'`,
    );
    assert.equal(step.masteredAt, null, "masteredAt should be null after draft POST");
    assert.equal(step.masteredByEmployeeId, null, "masteredByEmployeeId should be null after draft POST");
    assert.equal(step.masteredDuringObservationId, null, "masteredDuringObservationId should be null after draft POST");
  });

  /* ── Scenario b ──────────────────────────────────────────────────────
     PUT publish (draft→published) → step is mastered with correct audit
     fields.  Depends on scenario a having created the draft observation. */
  test("b — PUT publish with masterActionStepId transitions step to mastered", async () => {
    assert.ok(scenarioAbObsId, "Draft observation must exist from scenario a");
    assert.ok(scenarioAbStepId, "Action step must exist from scenario a");

    const putRes = await request(
      "PUT",
      `/observations/${scenarioAbObsId}`,
      {
        status:             "published",
        masterActionStepId: scenarioAbStepId,
      },
      adminJar,
    );

    assert.ok(
      putRes.status === 200 || putRes.status === 201,
      `Publish PUT expected 200/201, got ${putRes.status}: ${JSON.stringify(putRes.body)}`,
    );

    const step = await db.query.actionSteps.findFirst({
      where: eq(actionSteps.id, scenarioAbStepId),
    });
    assert.ok(step, "Action step should still exist after publish");
    assert.equal(
      step.status,
      "mastered",
      `Expected status 'mastered' after publish PUT, got '${step.status}'`,
    );
    assert.ok(step.masteredAt, "masteredAt should be set after publish");
    assert.equal(
      step.masteredByEmployeeId,
      ADMIN_EID,
      "masteredByEmployeeId should be the submitting user",
    );
    assert.equal(
      step.masteredDuringObservationId,
      scenarioAbObsId,
      "masteredDuringObservationId should reference the published observation",
    );
  });

  /* ── Scenario c ──────────────────────────────────────────────────────
     Three consecutive PUT draft autosaves carrying masterActionStepId →
     all return 200 and the step remains open throughout.                */
  test("c — three consecutive PUT draft autosaves with masterActionStepId all succeed and step stays open", async () => {
    /* Create a fresh draft observation */
    const draftRes = await request("POST", "/observations", {
      teacherId:     TEACHER_EID,
      rubricSetId:   rubricSetId,
      date:          "2026-07-21",
      time:          "10:00",
      course:        "MasterDraft Test C",
      scores:        {},
      strengths:     "Clear objectives",
      growthAreas:   "Cold-call equity",
      isWalkthrough: false,
      status:        "draft",
    }, adminJar);

    assert.ok(
      draftRes.status === 200 || draftRes.status === 201,
      `Draft POST expected 200/201, got ${draftRes.status}: ${JSON.stringify(draftRes.body)}`,
    );
    const draftBody = draftRes.body as { id?: string | number };
    assert.ok(draftBody.id, "Draft response should include id");
    scenarioCdObsId = Number(draftBody.id);

    /* Seed a fresh open step */
    const [seededStep] = await db.insert(actionSteps).values({
      schoolYearId:         1,
      teacherEmployeeId:    TEACHER_EID,
      assignedByEmployeeId: ADMIN_EID,
      text:                 "MASTERDRAFT-C: should remain open through multiple draft autosaves",
      dueDate:              "2027-12-31",
      status:               "open",
    }).returning();
    assert.ok(seededStep, "Should have inserted a test action step");
    scenarioCdStepId = seededStep.id;

    /* Three draft autosaves */
    for (let i = 1; i <= 3; i++) {
      const autosaveRes = await request(
        "PUT",
        `/observations/${scenarioCdObsId}`,
        {
          strengths:          `Autosave tick ${i}`,
          status:             "draft",
          masterActionStepId: scenarioCdStepId,
        },
        adminJar,
      );

      assert.ok(
        autosaveRes.status === 200 || autosaveRes.status === 201,
        `Autosave ${i} expected 200/201, got ${autosaveRes.status}: ${JSON.stringify(autosaveRes.body)}`,
      );

      const step = await db.query.actionSteps.findFirst({
        where: eq(actionSteps.id, scenarioCdStepId),
      });
      assert.ok(step, `Step should still exist after autosave ${i}`);
      assert.equal(
        step.status,
        "open",
        `Step should remain 'open' after autosave ${i}, got '${step.status}'`,
      );
    }
  });

  /* ── Scenario d ──────────────────────────────────────────────────────
     Final PUT publish after three draft autosaves → step mastered exactly
     once.  Depends on scenario c having created the draft + open step.  */
  test("d — final PUT publish after draft autosaves masters the step exactly once", async () => {
    assert.ok(scenarioCdObsId, "Draft observation must exist from scenario c");
    assert.ok(scenarioCdStepId, "Action step must exist from scenario c");

    const publishRes = await request(
      "PUT",
      `/observations/${scenarioCdObsId}`,
      {
        status:             "published",
        masterActionStepId: scenarioCdStepId,
      },
      adminJar,
    );

    assert.ok(
      publishRes.status === 200 || publishRes.status === 201,
      `Final publish PUT expected 200/201, got ${publishRes.status}: ${JSON.stringify(publishRes.body)}`,
    );

    const step = await db.query.actionSteps.findFirst({
      where: eq(actionSteps.id, scenarioCdStepId),
    });
    assert.ok(step, "Action step should still exist after final publish");
    assert.equal(
      step.status,
      "mastered",
      `Expected status 'mastered' after final publish, got '${step.status}'`,
    );
    assert.ok(step.masteredAt, "masteredAt should be set");
    assert.equal(
      step.masteredByEmployeeId,
      ADMIN_EID,
      "masteredByEmployeeId should be the submitting user",
    );
    assert.equal(
      step.masteredDuringObservationId,
      scenarioCdObsId,
      "masteredDuringObservationId should reference the published observation",
    );
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
