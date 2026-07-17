/**
 * Verification: frozen school snapshot on observations and action steps.
 *
 * Creates a teacher at School A, creates an observation + action step via HTTP,
 * then transfers the teacher to School B by updating people.schoolId.
 * Asserts that the already-created observation and action step still reference
 * School A (frozen at creation time), not School B.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:snapshot-freeze
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
const LEADER_EID  = "TST_SNAP_LEADER";
const TEACHER_EID = "TST_SNAP_TEACHER";

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

describe("Frozen school snapshots — observation and action step remain pinned after teacher transfer", () => {
  let leaderJar: Jar;

  /* ── Setup ─────────────────────────────────────────────────────────────── */
  before(async () => {
    /* Active school year */
    const [activeYear] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);
    assert.ok(activeYear, "No active school year found — seed the DB first");
    const activeSchoolYearId = activeYear.id;

    /* School A (MS) — where teacher starts */
    const [schA] = await db
      .insert(schools)
      .values({
        displayName:  "Test Snapshot School A",
        fullName:     "Test Snapshot School A Full",
        abbreviation: "TST-SNPA",
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

    /* School B (HS) — where teacher transfers to */
    const [schB] = await db
      .insert(schools)
      .values({
        displayName:  "Test Snapshot School B",
        fullName:     "Test Snapshot School B Full",
        abbreviation: "TST-SNPB",
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
        slug:         `tst-snap-rs-${Date.now()}`,
        name:         "Test Snapshot RS",
        target:       "TEACHER",
        isActive:     true,
        schoolYearId: activeSchoolYearId,
      })
      .returning({ id: rubricSets.id });
    assert.ok(rs, "Failed to insert rubric set");
    createdRubricSetId = rs.id;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "Snap Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat, "Failed to insert category");
    createdCategoryId = cat.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({
        categoryId:   cat.id,
        rubricSetId:  rs.id,
        schoolYearId: activeSchoolYearId,
        slug:         `tst-snap-domain-${Date.now()}`,
        name:         "Snap Domain",
        displayOrder: 1,
      })
      .returning({ id: rubricDomains.id });
    assert.ok(dom, "Failed to insert domain");
    createdDomainId = dom.id;

    /* School leader at School A */
    await db.insert(people).values({
      employeeId:               LEADER_EID,
      firstName:                "Snap",
      lastName:                 "Leader",
      email:                    "tst.snap.leader@example.com",
      role:                     "SCHOOL_LEADER",
      schoolId:                 SCHOOL_A_ID,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoUpdate({
      target: people.employeeId,
      set:    { schoolId: SCHOOL_A_ID, role: "SCHOOL_LEADER", isActive: true },
    });

    /* Teacher starts at School A (gradeSpan MS).
       Teachers use role NO_ACCESS in the person_role enum. */
    await db.insert(people).values({
      employeeId:               TEACHER_EID,
      firstName:                "Snap",
      lastName:                 "Teacher",
      email:                    "tst.snap.teacher@example.com",
      role:                     "NO_ACCESS",
      schoolId:                 SCHOOL_A_ID,
      isActive:                 true,
      includeInFeedbackTracker: true,
    }).onConflictDoUpdate({
      target: people.employeeId,
      set:    { schoolId: SCHOOL_A_ID, role: "NO_ACCESS", isActive: true },
    });

    leaderJar = await loginAs(LEADER_EID);
  });

  /* ── Teardown ───────────────────────────────────────────────────────────── */
  after(async () => {
    /* Restore teacher to School A so our schoolId FK cleanup works */
    await db.update(people).set({ schoolId: SCHOOL_A_ID }).where(eq(people.employeeId, TEACHER_EID));
    if (createdStepIds.length > 0) {
      await db.delete(actionSteps).where(inArray(actionSteps.id, createdStepIds));
    }
    if (createdObsIds.length > 0) {
      await db.delete(observations).where(inArray(observations.id, createdObsIds));
    }
    await db.delete(people).where(eq(people.employeeId, LEADER_EID));
    await db.delete(people).where(eq(people.employeeId, TEACHER_EID));
    if (createdDomainId)   await db.delete(rubricDomains).where(eq(rubricDomains.id, createdDomainId));
    if (createdCategoryId) await db.delete(rubricCategories).where(eq(rubricCategories.id, createdCategoryId));
    if (createdRubricSetId) await db.delete(rubricSets).where(eq(rubricSets.id, createdRubricSetId));
    if (createdSchoolBId)  await db.delete(schools).where(eq(schools.id, createdSchoolBId));
    if (createdSchoolAId)  await db.delete(schools).where(eq(schools.id, createdSchoolAId));
  });

  /* ── Test 1: POST creates observation with schoolId + gradeSpan from School A ── */
  let obsId: number;
  let stepId: number;

  test("1 — POST /observations captures teacher's current school (A) and grade span (MS) into frozen fields", async () => {
    const today = new Date().toISOString().split("T")[0]!;
    const futureDate = new Date(Date.now() + 7 * 86400_000).toISOString().split("T")[0]!;

    const res = await request("POST", "/observations", {
      observedEmployeeId: TEACHER_EID,
      rubricSetId:        createdRubricSetId,
      date:               today,
      strengths:          "TST_SNAP_STRENGTH",
      growthAreas:        "TST_SNAP_GROWTH",
      status:             "draft",
      newActionStep:      { text: "TST_SNAP_STEP", dueDate: futureDate },
    }, leaderJar);

    assert.equal(res.status, 201, `POST /observations returned ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as Record<string, unknown>;
    assert.ok(body.id, "Response must include an id");
    obsId = Number(body.id);
    createdObsIds.push(obsId);

    /* Verify frozen fields directly in DB */
    const [row] = await db
      .select({
        schoolId:          observations.schoolId,
        snapshotGradeSpan: observations.snapshotGradeSpan,
      })
      .from(observations)
      .where(eq(observations.id, obsId));

    assert.ok(row, "Observation row not found in DB");
    assert.equal(row.schoolId, SCHOOL_A_ID,
      `Expected observation.schoolId = ${SCHOOL_A_ID} (School A), got ${row.schoolId}`);
    assert.equal(row.snapshotGradeSpan, "MS",
      `Expected observation.snapshotGradeSpan = 'MS' (School A grade span), got ${row.snapshotGradeSpan}`);

    /* Find the action step created with this observation */
    const [step] = await db
      .select({
        id:                actionSteps.id,
        snapshotSchoolId:  actionSteps.snapshotSchoolId,
        snapshotGradeSpan: actionSteps.snapshotGradeSpan,
        snapshotRole:      actionSteps.snapshotRole,
      })
      .from(actionSteps)
      .where(eq(actionSteps.assignedDuringObservationId, obsId));

    assert.ok(step, "Action step row not found in DB");
    stepId = step.id;
    createdStepIds.push(stepId);

    assert.equal(step.snapshotSchoolId, SCHOOL_A_ID,
      `Expected actionStep.snapshotSchoolId = ${SCHOOL_A_ID}, got ${step.snapshotSchoolId}`);
    assert.equal(step.snapshotGradeSpan, "MS",
      `Expected actionStep.snapshotGradeSpan = 'MS', got ${step.snapshotGradeSpan}`);
    assert.equal(step.snapshotRole, "NO_ACCESS",
      `Expected actionStep.snapshotRole = 'NO_ACCESS' (teachers use NO_ACCESS enum value), got ${step.snapshotRole}`);
  });

  /* ── Test 2: Transfer teacher to School B ─────────────────────────────── */
  test("2 — Transfer teacher from School A → School B (simulating a re-assignment)", async () => {
    await db
      .update(people)
      .set({ schoolId: SCHOOL_B_ID })
      .where(eq(people.employeeId, TEACHER_EID));

    /* Confirm the people record now shows School B */
    const [updated] = await db
      .select({ schoolId: people.schoolId })
      .from(people)
      .where(eq(people.employeeId, TEACHER_EID));

    assert.equal(updated?.schoolId, SCHOOL_B_ID,
      `Expected people.schoolId to be updated to ${SCHOOL_B_ID}, got ${updated?.schoolId}`);
  });

  /* ── Test 3: Historical observation still shows School A ──────────────── */
  test("3 — Observation schoolId and snapshotGradeSpan are UNCHANGED after teacher transfer", async () => {
    const [row] = await db
      .select({
        schoolId:          observations.schoolId,
        snapshotGradeSpan: observations.snapshotGradeSpan,
      })
      .from(observations)
      .where(eq(observations.id, obsId));

    assert.ok(row, "Observation row not found in DB after transfer");
    assert.equal(row.schoolId, SCHOOL_A_ID,
      `FREEZE FAIL: observation.schoolId changed to ${row.schoolId} after transfer (expected ${SCHOOL_A_ID})`);
    assert.equal(row.snapshotGradeSpan, "MS",
      `FREEZE FAIL: observation.snapshotGradeSpan changed to '${row.snapshotGradeSpan}' after transfer (expected 'MS')`);
  });

  /* ── Test 4: Historical action step still shows School A ──────────────── */
  test("4 — Action step snapshot fields are UNCHANGED after teacher transfer", async () => {
    const [step] = await db
      .select({
        snapshotSchoolId:  actionSteps.snapshotSchoolId,
        snapshotGradeSpan: actionSteps.snapshotGradeSpan,
        snapshotRole:      actionSteps.snapshotRole,
      })
      .from(actionSteps)
      .where(eq(actionSteps.id, stepId));

    assert.ok(step, "Action step row not found in DB after transfer");
    assert.equal(step.snapshotSchoolId, SCHOOL_A_ID,
      `FREEZE FAIL: actionStep.snapshotSchoolId changed to ${step.snapshotSchoolId} after transfer (expected ${SCHOOL_A_ID})`);
    assert.equal(step.snapshotGradeSpan, "MS",
      `FREEZE FAIL: actionStep.snapshotGradeSpan changed to '${step.snapshotGradeSpan}' after transfer (expected 'MS')`);
    assert.equal(step.snapshotRole, "NO_ACCESS",
      `FREEZE FAIL: actionStep.snapshotRole changed to '${step.snapshotRole}' after transfer (expected 'NO_ACCESS')`);
  });

  /* ── Test 5: A NEW observation created after transfer captures School B ── */
  test("5 — A NEW observation created AFTER the transfer captures School B (HS) into its snapshot", async () => {
    /* Log in as a network admin (no school restriction) since leader is still at A */
    const [networkAdmin] = await db
      .select({ employeeId: people.employeeId })
      .from(people)
      .where(eq(people.role, "NETWORK_ADMIN"))
      .limit(1);
    assert.ok(networkAdmin, "No NETWORK_ADMIN found — needed to create obs for teacher now at School B");

    const adminJar = await loginAs(networkAdmin.employeeId);
    const today = new Date().toISOString().split("T")[0]!;

    const res = await request("POST", "/observations", {
      observedEmployeeId: TEACHER_EID,
      rubricSetId:        createdRubricSetId,
      date:               today,
      strengths:          "TST_SNAP_AFTER_TRANSFER",
      status:             "draft",
    }, adminJar);

    assert.equal(res.status, 201, `POST /observations after transfer returned ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as Record<string, unknown>;
    const newObsId = Number(body.id);
    createdObsIds.push(newObsId);

    const [row] = await db
      .select({
        schoolId:          observations.schoolId,
        snapshotGradeSpan: observations.snapshotGradeSpan,
      })
      .from(observations)
      .where(eq(observations.id, newObsId));

    assert.ok(row, "New observation row not found in DB");
    assert.equal(row.schoolId, SCHOOL_B_ID,
      `Expected new observation.schoolId = ${SCHOOL_B_ID} (School B), got ${row.schoolId}`);
    assert.equal(row.snapshotGradeSpan, "HS",
      `Expected new observation.snapshotGradeSpan = 'HS' (School B grade span), got ${row.snapshotGradeSpan}`);
  });
});
