/**
 * Regression test: cross-school data leak via action-steps authorization.
 *
 * Verifies that action-step authorization uses the step's immutable
 * snapshotSchoolId rather than the teacher's current people.schoolId.
 * After a teacher transfers from School A → School B:
 *   - School A principal can still GET, master, and edit steps created at A.
 *   - School B principal gets 403 on those same steps.
 *   - Steps created AFTER the transfer are accessible to School B and blocked
 *     from School A.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:action-step-transfer-authz
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  people,
  schools,
  observations,
  actionSteps,
  rubricSets,
  rubricCategories,
  rubricDomains,
  schoolYears,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── Unique employee IDs ─────────────────────────────────────────────────── */
const LEADER_A_EID  = "TST_TRF_LEADER_A";
const LEADER_B_EID  = "TST_TRF_LEADER_B";
const TEACHER_EID   = "TST_TRF_TEACHER";

/* ── Tracking for cleanup ────────────────────────────────────────────────── */
let SCHOOL_A_ID: number;
let SCHOOL_B_ID: number;
let createdSchoolAId: number | null = null;
let createdSchoolBId: number | null = null;
let createdRubricSetId: number | null = null;
let createdCategoryId: number | null = null;
let createdDomainId: number | null = null;
const createdObsIds: number[] = [];
const createdStepIds: number[] = [];

process.on("exit", () => { pool.end().catch(() => {}); });

/* ── HTTP helpers ────────────────────────────────────────────────────────── */

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
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  assert.ok(setCookie, "dev-login must return a Set-Cookie header");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

/* ── Suite ───────────────────────────────────────────────────────────────── */

describe("Action-step transfer authorization — snapshotSchoolId governs access after teacher transfer", () => {
  let leaderAJar: Jar;
  let leaderBJar: Jar;

  /* ── Setup ─────────────────────────────────────────────────────────────── */
  before(async () => {
    const [activeYear] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);
    assert.ok(activeYear, "No active school year found — seed the DB first");
    const activeSchoolYearId = activeYear.id;

    /* School A — where teacher starts */
    const [schA] = await db
      .insert(schools)
      .values({
        displayName:  "Test Transfer School A",
        fullName:     "Test Transfer School A Full",
        abbreviation: "TST-TRFA",
        region:       "Boston",
        gradeSpan:    "MS",
        isActive:     true,
        isArchived:   false,
        isHomeOffice: false,
      })
      .returning({ id: schools.id });
    assert.ok(schA, "Failed to insert School A");
    SCHOOL_A_ID = schA.id;
    createdSchoolAId = schA.id;

    /* School B — where teacher transfers to */
    const [schB] = await db
      .insert(schools)
      .values({
        displayName:  "Test Transfer School B",
        fullName:     "Test Transfer School B Full",
        abbreviation: "TST-TRFB",
        region:       "NYC",
        gradeSpan:    "HS",
        isActive:     true,
        isArchived:   false,
        isHomeOffice: false,
      })
      .returning({ id: schools.id });
    assert.ok(schB, "Failed to insert School B");
    SCHOOL_B_ID = schB.id;
    createdSchoolBId = schB.id;

    /* Rubric set for TEACHER target */
    const [rs] = await db
      .insert(rubricSets)
      .values({
        slug:         `tst-trf-rs-${Date.now()}`,
        name:         "Test Transfer RS",
        target:       "TEACHER",
        isActive:     true,
        schoolYearId: activeSchoolYearId,
      })
      .returning({ id: rubricSets.id });
    assert.ok(rs, "Failed to insert rubric set");
    createdRubricSetId = rs.id;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "Transfer Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat, "Failed to insert category");
    createdCategoryId = cat.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({
        categoryId:   cat.id,
        rubricSetId:  rs.id,
        schoolYearId: activeSchoolYearId,
        slug:         `tst-trf-domain-${Date.now()}`,
        name:         "Transfer Domain",
        displayOrder: 1,
      })
      .returning({ id: rubricDomains.id });
    assert.ok(dom, "Failed to insert domain");
    createdDomainId = dom.id;

    /* School leader at School A */
    await db.insert(people).values({
      employeeId:               LEADER_A_EID,
      firstName:                "Transfer",
      lastName:                 "LeaderA",
      email:                    "tst.trf.leadera@example.com",
      role:                     "SCHOOL_LEADER",
      schoolId:                 SCHOOL_A_ID,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoUpdate({
      target: people.employeeId,
      set:    { schoolId: SCHOOL_A_ID, role: "SCHOOL_LEADER", isActive: true },
    });

    /* School leader at School B */
    await db.insert(people).values({
      employeeId:               LEADER_B_EID,
      firstName:                "Transfer",
      lastName:                 "LeaderB",
      email:                    "tst.trf.leaderb@example.com",
      role:                     "SCHOOL_LEADER",
      schoolId:                 SCHOOL_B_ID,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoUpdate({
      target: people.employeeId,
      set:    { schoolId: SCHOOL_B_ID, role: "SCHOOL_LEADER", isActive: true },
    });

    /* Teacher starts at School A */
    await db.insert(people).values({
      employeeId:               TEACHER_EID,
      firstName:                "Transfer",
      lastName:                 "Teacher",
      email:                    "tst.trf.teacher@example.com",
      role:                     "NO_ACCESS",
      schoolId:                 SCHOOL_A_ID,
      isActive:                 true,
      includeInFeedbackTracker: true,
    }).onConflictDoUpdate({
      target: people.employeeId,
      set:    { schoolId: SCHOOL_A_ID, role: "NO_ACCESS", isActive: true },
    });

    leaderAJar = await loginAs(LEADER_A_EID);
    leaderBJar = await loginAs(LEADER_B_EID);
  });

  /* ── Teardown ───────────────────────────────────────────────────────────── */
  after(async () => {
    /* Restore teacher to School A so FK cleanup works */
    await db.update(people).set({ schoolId: SCHOOL_A_ID }).where(eq(people.employeeId, TEACHER_EID));
    if (createdStepIds.length > 0) {
      await db.delete(actionSteps).where(inArray(actionSteps.id, createdStepIds));
    }
    if (createdObsIds.length > 0) {
      await db.delete(observations).where(inArray(observations.id, createdObsIds));
    }
    await db.delete(people).where(eq(people.employeeId, LEADER_A_EID));
    await db.delete(people).where(eq(people.employeeId, LEADER_B_EID));
    await db.delete(people).where(eq(people.employeeId, TEACHER_EID));
    if (createdDomainId)    await db.delete(rubricDomains).where(eq(rubricDomains.id, createdDomainId));
    if (createdCategoryId)  await db.delete(rubricCategories).where(eq(rubricCategories.id, createdCategoryId));
    if (createdRubricSetId) await db.delete(rubricSets).where(eq(rubricSets.id, createdRubricSetId));
    if (createdSchoolBId)   await db.delete(schools).where(eq(schools.id, createdSchoolBId));
    if (createdSchoolAId)   await db.delete(schools).where(eq(schools.id, createdSchoolAId));
  });

  /* ── State shared across tests ──────────────────────────────────────────── */
  let stepAId: number;
  let stepBId: number;

  /* ── Test 1: Create action step while teacher is at School A ─────────── */
  test("1 — School A leader creates an observation + action step for the teacher (at School A)", async () => {
    const today = new Date().toISOString().split("T")[0]!;
    const futureDate = new Date(Date.now() + 7 * 86400_000).toISOString().split("T")[0]!;

    const res = await request("POST", "/observations", {
      observedEmployeeId: TEACHER_EID,
      rubricSetId:        createdRubricSetId,
      date:               today,
      strengths:          "TST_TRF_STRENGTH_A",
      growthAreas:        "TST_TRF_GROWTH_A",
      status:             "draft",
      newActionStep:      { text: "TST_TRF_STEP_A", dueDate: futureDate },
    }, leaderAJar);

    assert.equal(res.status, 201, `POST /observations returned ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as Record<string, unknown>;
    assert.ok(body.id, "Response must include an id");
    const obsId = Number(body.id);
    createdObsIds.push(obsId);

    const [step] = await db
      .select({ id: actionSteps.id, snapshotSchoolId: actionSteps.snapshotSchoolId })
      .from(actionSteps)
      .where(eq(actionSteps.assignedDuringObservationId, obsId));

    assert.ok(step, "Action step must be created with the observation");
    assert.equal(step.snapshotSchoolId, SCHOOL_A_ID,
      `snapshotSchoolId must equal School A (${SCHOOL_A_ID}), got ${step.snapshotSchoolId}`);
    stepAId = step.id;
    createdStepIds.push(stepAId);
  });

  /* ── Test 2: Transfer teacher to School B ─────────────────────────────── */
  test("2 — Transfer teacher from School A → School B", async () => {
    await db
      .update(people)
      .set({ schoolId: SCHOOL_B_ID })
      .where(eq(people.employeeId, TEACHER_EID));

    const [updated] = await db
      .select({ schoolId: people.schoolId })
      .from(people)
      .where(eq(people.employeeId, TEACHER_EID));

    assert.equal(updated?.schoolId, SCHOOL_B_ID,
      `Expected people.schoolId to be ${SCHOOL_B_ID} (School B), got ${updated?.schoolId}`);
  });

  /* ── Test 3: School A leader can still access the pre-transfer step ───── */
  test("3 — School A leader: GET /action-steps returns the pre-transfer step (200)", async () => {
    const res = await request("GET", `/action-steps?teacherEmployeeId=${TEACHER_EID}`, undefined, leaderAJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const rows = res.body as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(rows), "Response must be an array");
    const found = rows.find((r) => r.id === stepAId);
    assert.ok(found, `School A leader must see step ${stepAId} in GET /action-steps (still owned by School A snapshot)`);
  });

  test("4 — School A leader: GET /action-steps/latest returns the pre-transfer step (200)", async () => {
    const res = await request("GET", `/action-steps/latest?teacherEmployeeId=${TEACHER_EID}`, undefined, leaderAJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as Record<string, unknown> | null;
    assert.ok(body !== null, "Expected a step, got null");
    assert.equal(body!.id, stepAId,
      `School A leader must see step ${stepAId} as latest, got ${body!.id}`);
  });

  test("5 — School A leader: PATCH /master on the pre-transfer step returns 200", async () => {
    const res = await request("PATCH", `/action-steps/${stepAId}/master`, {}, leaderAJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as Record<string, unknown>;
    assert.equal((body.actionStep as Record<string, unknown>)?.status, "mastered",
      "Step must be mastered after PATCH /master");
  });

  /* ── Test 6: School B leader is blocked from the pre-transfer step ──────
     The step is already mastered; we test PATCH /:id (edit) and GET endpoints. */
  test("6 — School B leader: GET /action-steps must NOT see the pre-transfer step (School A snapshot)", async () => {
    const res = await request("GET", `/action-steps?teacherEmployeeId=${TEACHER_EID}`, undefined, leaderBJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const rows = res.body as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(rows), "Response must be an array");
    const found = rows.find((r) => r.id === stepAId);
    assert.equal(found, undefined,
      `School B leader must NOT see step ${stepAId} (snapshotSchoolId = School A) in GET /action-steps`);
  });

  test("7 — School B leader: GET /action-steps/latest must NOT return the pre-transfer step", async () => {
    const res = await request("GET", `/action-steps/latest?teacherEmployeeId=${TEACHER_EID}`, undefined, leaderBJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as Record<string, unknown> | null;
    const isStepA = body !== null && body.id === stepAId;
    assert.equal(isStepA, false,
      `School B leader must NOT see pre-transfer step ${stepAId} as latest`);
  });

  test("8 — School B leader: PATCH /master on the pre-transfer step returns 403", async () => {
    const res = await request("PATCH", `/action-steps/${stepAId}/master`, {}, leaderBJar);
    assert.equal(res.status, 403,
      `Expected 403 from School B leader on PATCH /master for School A step, got ${res.status}`);
  });

  test("9 — School B leader: PATCH /:id (edit) on the pre-transfer step returns 400 or 403", async () => {
    /* The step is mastered so the server returns 400 before the auth check
       for the PATCH /:id route. Either 400 (mastered) or 403 (wrong school)
       is acceptable — what must NOT happen is 200. */
    const futureDate = new Date(Date.now() + 14 * 86400_000).toISOString().split("T")[0]!;
    const res = await request("PATCH", `/action-steps/${stepAId}`, { dueDate: futureDate }, leaderBJar);
    assert.ok(
      res.status === 400 || res.status === 403,
      `Expected 400 or 403 from School B leader on PATCH /:id for School A step, got ${res.status}`,
    );
  });

  /* ── Test 10: Create a NEW step after the transfer (School B) ──────────
     We need a NETWORK_ADMIN or NETWORK_LEADER to create the obs for a teacher
     now at School B (School A leader can no longer observe them there).       */
  test("10 — Create a new action step AFTER the transfer; it belongs to School B", async () => {
    const [networkAdmin] = await db
      .select({ employeeId: people.employeeId })
      .from(people)
      .where(eq(people.role, "NETWORK_ADMIN"))
      .limit(1);
    assert.ok(networkAdmin, "No NETWORK_ADMIN found — needed to create obs for teacher now at School B");

    const adminJar = await loginAs(networkAdmin.employeeId);
    const today = new Date().toISOString().split("T")[0]!;
    const futureDate = new Date(Date.now() + 7 * 86400_000).toISOString().split("T")[0]!;

    const res = await request("POST", "/observations", {
      observedEmployeeId: TEACHER_EID,
      rubricSetId:        createdRubricSetId,
      date:               today,
      strengths:          "TST_TRF_STRENGTH_B",
      status:             "draft",
      newActionStep:      { text: "TST_TRF_STEP_B", dueDate: futureDate },
    }, adminJar);

    assert.equal(res.status, 201, `POST /observations returned ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as Record<string, unknown>;
    const obsId = Number(body.id);
    createdObsIds.push(obsId);

    const [step] = await db
      .select({ id: actionSteps.id, snapshotSchoolId: actionSteps.snapshotSchoolId })
      .from(actionSteps)
      .where(eq(actionSteps.assignedDuringObservationId, obsId));

    assert.ok(step, "Action step must be created with the observation");
    assert.equal(step.snapshotSchoolId, SCHOOL_B_ID,
      `snapshotSchoolId must equal School B (${SCHOOL_B_ID}), got ${step.snapshotSchoolId}`);
    stepBId = step.id;
    createdStepIds.push(stepBId);
  });

  test("11 — School B leader: GET /action-steps sees the post-transfer step (200)", async () => {
    const res = await request("GET", `/action-steps?teacherEmployeeId=${TEACHER_EID}`, undefined, leaderBJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const rows = res.body as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(rows), "Response must be an array");
    const found = rows.find((r) => r.id === stepBId);
    assert.ok(found, `School B leader must see post-transfer step ${stepBId}`);
  });

  test("12 — School A leader: GET /action-steps must NOT see the post-transfer step (School B snapshot)", async () => {
    const res = await request("GET", `/action-steps?teacherEmployeeId=${TEACHER_EID}`, undefined, leaderAJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const rows = res.body as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(rows), "Response must be an array");
    const found = rows.find((r) => r.id === stepBId);
    assert.equal(found, undefined,
      `School A leader must NOT see post-transfer step ${stepBId} (snapshotSchoolId = School B)`);
  });

  test("13 — School A leader: PATCH /master on the post-transfer step returns 403", async () => {
    const res = await request("PATCH", `/action-steps/${stepBId}/master`, {}, leaderAJar);
    assert.equal(res.status, 403,
      `Expected 403 from School A leader on PATCH /master for School B step, got ${res.status}`);
  });

  test("14 — School A leader: PATCH /:id (edit) on the post-transfer step returns 403", async () => {
    const futureDate = new Date(Date.now() + 14 * 86400_000).toISOString().split("T")[0]!;
    const res = await request("PATCH", `/action-steps/${stepBId}`, { dueDate: futureDate }, leaderAJar);
    assert.equal(res.status, 403,
      `Expected 403 from School A leader on PATCH /:id for School B step, got ${res.status}`);
  });
});
