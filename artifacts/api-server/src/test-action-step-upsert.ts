/**
 * Regression test: PUT /api/observations/:id action-step upsert guard.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:action-step-upsert
 *
 * Requires the dev server to be running (NODE_ENV=development).
 *
 * Scenarios:
 *   1. PUT with newActionStep on a fresh observation → exactly 1 step created
 *   2. PUT again with newActionStep (different text)  → still exactly 1 step,
 *      text updated (upsert, not insert)
 *   3. PUT with newActionStep when step is already mastered → mastered step
 *      left untouched, no new step inserted
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
import { eq, inArray, and } from "drizzle-orm";
import { asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const ADMIN_EID   = "U10";             /* Brendan Campbell — NETWORK_ADMIN */
const TEACHER_EID = "TST_ASUPSERT_TCH";
const LEADER_EID  = "TST_ASUPSERT_SL";

/* ── HTTP helpers ─────────────────────────────────────────────────────── */

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
  assert.ok(setCookie, "dev-login should return Set-Cookie");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

/* ── Test state ───────────────────────────────────────────────────────── */

let adminJar: Jar;
let testSchoolId: number;
let rubricSetId: number;
let obsId: number;                /* the observation used across all three scenarios */

/* ── Suite ────────────────────────────────────────────────────────────── */

describe("PUT /observations/:id — action-step upsert guard", () => {
  before(async () => {
    /* Resolve an existing school and rubric set */
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

    /* Create test people */
    await db.insert(people).values([
      {
        employeeId: TEACHER_EID,
        firstName: "Upsert",
        lastName: "Teacher",
        email: "upsert.teacher@test.example.com",
        role: "NO_ACCESS",
        schoolId: testSchoolId,
        isActive: true,
        includeInFeedbackTracker: true,
      },
      {
        employeeId: LEADER_EID,
        firstName: "Upsert",
        lastName: "Leader",
        email: "upsert.leader@test.example.com",
        role: "SCHOOL_LEADER",
        schoolId: testSchoolId,
        isActive: true,
        includeInFeedbackTracker: false,
      },
    ]).onConflictDoNothing();

    adminJar = await loginAs(ADMIN_EID);

    /* Create a published TEACHER-target observation (no action step yet) */
    const res = await request("POST", "/observations", {
      teacherId:     TEACHER_EID,
      rubricSetId:   rubricSetId,
      date:          "2026-07-18",
      time:          "09:00",
      course:        "Upsert Guard Test",
      scores:        {},
      strengths:     "Clear explanations",
      growthAreas:   "Cold-calling",
      isWalkthrough: false,
      status:        "published",
    }, adminJar);
    assert.ok(
      res.status === 200 || res.status === 201,
      `POST /observations expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const body = res.body as { id?: string | number };
    assert.ok(body.id, "Observation response must include id");
    obsId = Number(body.id);
  });

  after(async () => {
    /* Clean up: action steps linked to the test observation, then the
       observation itself, then test people */
    await db.delete(actionSteps)
      .where(eq(actionSteps.assignedDuringObservationId, obsId))
      .catch(() => {});
    if (obsId) {
      await db.delete(observations).where(eq(observations.id, obsId)).catch(() => {});
    }
    await db
      .delete(people)
      .where(inArray(people.employeeId, [TEACHER_EID, LEADER_EID]))
      .catch(() => {});
  });

  /* ── Scenario 1 ──────────────────────────────────────────────────────
     First PUT with newActionStep → exactly 1 action step row is created. */
  test("1 — first PUT with newActionStep creates exactly 1 action step", async () => {
    const putRes = await request("PUT", `/observations/${obsId}`, {
      newActionStep: {
        text:    "Upsert S1: Name students before posing cold-call questions",
        dueDate: "2027-06-01",
      },
    }, adminJar);

    assert.ok(
      putRes.status === 200 || putRes.status === 201,
      `PUT expected 200/201, got ${putRes.status}: ${JSON.stringify(putRes.body)}`,
    );

    const steps = await db.query.actionSteps.findMany({
      where: eq(actionSteps.assignedDuringObservationId, obsId),
    });
    assert.equal(
      steps.length,
      1,
      `Expected exactly 1 action step linked to obs ${obsId}, found ${steps.length}`,
    );
    assert.equal(steps[0]!.text, "Upsert S1: Name students before posing cold-call questions");
    assert.equal(steps[0]!.status, "open");
  });

  /* ── Scenario 2 ──────────────────────────────────────────────────────
     Second PUT with newActionStep (different text) → still exactly 1 row,
     text is updated in-place (upsert, not insert).                       */
  test("2 — second PUT with newActionStep updates in-place — still exactly 1 step", async () => {
    const putRes = await request("PUT", `/observations/${obsId}`, {
      newActionStep: {
        text:    "Upsert S2: UPDATED — wait 3 seconds before cold-calling",
        dueDate: "2027-07-01",
      },
    }, adminJar);

    assert.ok(
      putRes.status === 200 || putRes.status === 201,
      `PUT expected 200/201, got ${putRes.status}: ${JSON.stringify(putRes.body)}`,
    );

    const steps = await db.query.actionSteps.findMany({
      where: eq(actionSteps.assignedDuringObservationId, obsId),
    });
    assert.equal(
      steps.length,
      1,
      `Expected exactly 1 action step after second PUT (upsert), found ${steps.length} — duplicate was inserted`,
    );
    assert.equal(
      steps[0]!.text,
      "Upsert S2: UPDATED — wait 3 seconds before cold-calling",
      "Step text should be updated to the latest value",
    );
    assert.equal(steps[0]!.dueDate, "2027-07-01", "dueDate should be updated");
    assert.equal(steps[0]!.status, "open", "Step status should remain open");
  });

  /* ── Scenario 3 ──────────────────────────────────────────────────────
     PUT with newActionStep when the existing step is already mastered →
     the mastered step is left untouched, no new step is inserted.        */
  test("3 — PUT with newActionStep when step is already mastered leaves it untouched", async () => {
    /* Mark the existing step as mastered directly in the DB to simulate
       the teacher having already mastered it before this autosave fires. */
    const [existing] = await db.query.actionSteps.findMany({
      where: eq(actionSteps.assignedDuringObservationId, obsId),
    });
    assert.ok(existing, "Should have exactly 1 step from scenario 2");

    await db.update(actionSteps)
      .set({
        status:              "mastered",
        masteredAt:          new Date(),
        masteredByEmployeeId: ADMIN_EID,
      })
      .where(eq(actionSteps.id, existing.id));

    /* Now call PUT again with a new newActionStep */
    const putRes = await request("PUT", `/observations/${obsId}`, {
      newActionStep: {
        text:    "Upsert S3: Should NOT overwrite the mastered step",
        dueDate: "2027-08-01",
      },
    }, adminJar);

    assert.ok(
      putRes.status === 200 || putRes.status === 201,
      `PUT expected 200/201, got ${putRes.status}: ${JSON.stringify(putRes.body)}`,
    );

    const stepsAfter = await db.query.actionSteps.findMany({
      where: eq(actionSteps.assignedDuringObservationId, obsId),
    });

    /* Still exactly 1 row — no new step was inserted */
    assert.equal(
      stepsAfter.length,
      1,
      `Expected exactly 1 action step (mastered step preserved, no new insert), found ${stepsAfter.length}`,
    );

    /* The row should still be the original mastered step, text unchanged */
    assert.equal(
      stepsAfter[0]!.status,
      "mastered",
      "Mastered step should not have been overwritten",
    );
    assert.equal(
      stepsAfter[0]!.text,
      "Upsert S2: UPDATED — wait 3 seconds before cold-calling",
      "Mastered step text should remain as-was (not overwritten by new newActionStep)",
    );
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
