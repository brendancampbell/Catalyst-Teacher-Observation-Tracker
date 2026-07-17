/**
 * Regression tests for cross-school COACH auth on observations and action-center endpoints.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:coach-cross-school-auth
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. COACH from School A → GET /observations/:id (SCHOOL-target, School B) → 403
 *   2. COACH from School A → GET /observations/:id (SCHOOL-target, School A) → 200
 *   3. COACH /action-center/network-averages with a SCHOOL-target rubric set
 *      → domainAverages reflect only their own school's observations (not another school's)
 *   4. COACH /action-center/rescore-queue → only School A people appear (School B excluded)
 *   5. COACH /action-center/overdue-observations → only School A people appear (School B excluded)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { observations, observationScores, people, schools, rubricSets, rubricCategories, rubricDomains, schoolYears } from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* Resolved dynamically in before() */
let SCHOOL_A_ID: number;
let SCHOOL_B_ID: number;
let SCHOOL_RUBRIC_SET_ID: number;
let SCHOOL_RUBRIC_SET_SLUG: string;

/* Temporary test user employee IDs */
const COACH_A_EID          = "TST_COACH_CROSS_A";
const RESCORE_PERSON_A_EID = "TST_COACH_RESCORE_A";  /* School A — should appear in rescore-queue */
const RESCORE_PERSON_B_EID = "TST_COACH_RESCORE_B";  /* School B — must NOT appear for Coach A */
const OVERDUE_PERSON_A_EID = "TST_COACH_OVERDUE_A";  /* School A — should appear in overdue-obs */
const OVERDUE_PERSON_B_EID = "TST_COACH_OVERDUE_B";  /* School B — must NOT appear for Coach A */

const ALL_TEST_EIDS = [
  COACH_A_EID,
  RESCORE_PERSON_A_EID,
  RESCORE_PERSON_B_EID,
  OVERDUE_PERSON_A_EID,
  OVERDUE_PERSON_B_EID,
];

/* Track inserted IDs for cleanup */
const createdObsIds: number[] = [];
const createdScoreIds: number[] = [];
let createdRubricSetId: number | null = null;
let createdCategoryId: number | null = null;
let createdDomainId: number | null = null;

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function request(
  method: string,
  path: string,
  body: unknown,
  jar?: Jar,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar?.cookieHeader) headers["Cookie"] = jar.cookieHeader;

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

/* ── Test state ───────────────────────────────────────────────────────────── */

let coachAJar: Jar;
let obsSchoolAId: number;
let obsSchoolBId: number;
const TEST_DOMAIN_SLUG = "tst_coach_domain";

describe("Cross-school auth — COACH role", () => {
  before(async () => {
    /* Resolve two distinct school IDs from the live DB */
    const twoSchools = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(2);
    assert.equal(twoSchools.length, 2, "Need at least 2 schools in the DB to run this test");
    SCHOOL_A_ID = twoSchools[0]!.id;
    SCHOOL_B_ID = twoSchools[1]!.id;

    /* Create a dedicated SCHOOL-target rubric set so we can control scores precisely */
    const slug = `tst-coach-school-rs-${Date.now()}`;
    const [activeYear] = await db.select({ id: schoolYears.id }).from(schoolYears).where(eq(schoolYears.status, "active")).limit(1);
    const activeSchoolYearId = activeYear!.id;
    const [rs] = await db
      .insert(rubricSets)
      .values({ slug, name: "Test Coach School RS", target: "SCHOOL", isActive: true, schoolYearId: activeSchoolYearId })
      .returning({ id: rubricSets.id, slug: rubricSets.slug });
    assert.ok(rs, "Failed to insert test rubric set");
    createdRubricSetId     = rs.id;
    SCHOOL_RUBRIC_SET_ID   = rs.id;
    SCHOOL_RUBRIC_SET_SLUG = rs.slug;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "Test Coach Category", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat, "Failed to insert test rubric category");
    createdCategoryId = cat.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({ categoryId: cat.id, rubricSetId: rs.id, schoolYearId: activeSchoolYearId, slug: TEST_DOMAIN_SLUG, name: "Test Coach Domain", displayOrder: 1 })
      .returning({ id: rubricDomains.id });
    assert.ok(dom, "Failed to insert test rubric domain");
    createdDomainId = dom.id;

    /* Create all test people in one batch */
    await db.insert(people).values([
      /* The COACH under test — assigned to School A */
      {
        employeeId:               COACH_A_EID,
        firstName:                "Test",
        lastName:                 "CoachA",
        email:                    "tst.coach.a.crossschool@example.com",
        role:                     "COACH",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      /* School A person who needs a rescore — should appear in Coach A's rescore-queue */
      {
        employeeId:               RESCORE_PERSON_A_EID,
        firstName:                "Rescore",
        lastName:                 "SchoolA",
        email:                    "tst.rescore.a@example.com",
        role:                     "NO_ACCESS",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: true,
        needsRescore:             true,
        rescoreDueDate:           "2025-06-01",
      },
      /* School B person who needs a rescore — must NOT appear in Coach A's rescore-queue */
      {
        employeeId:               RESCORE_PERSON_B_EID,
        firstName:                "Rescore",
        lastName:                 "SchoolB",
        email:                    "tst.rescore.b@example.com",
        role:                     "NO_ACCESS",
        schoolId:                 SCHOOL_B_ID,
        isActive:                 true,
        includeInFeedbackTracker: true,
        needsRescore:             true,
        rescoreDueDate:           "2025-06-01",
      },
      /* School A teacher with no observations — should appear in Coach A's overdue list */
      {
        employeeId:               OVERDUE_PERSON_A_EID,
        firstName:                "Overdue",
        lastName:                 "SchoolA",
        email:                    "tst.overdue.a@example.com",
        role:                     "NO_ACCESS",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: true,
        needsRescore:             false,
      },
      /* School B teacher with no observations — must NOT appear in Coach A's overdue list */
      {
        employeeId:               OVERDUE_PERSON_B_EID,
        firstName:                "Overdue",
        lastName:                 "SchoolB",
        email:                    "tst.overdue.b@example.com",
        role:                     "NO_ACCESS",
        schoolId:                 SCHOOL_B_ID,
        isActive:                 true,
        includeInFeedbackTracker: true,
        needsRescore:             false,
      },
    ]).onConflictDoNothing();

    /* Insert a SCHOOL-target observation for School A with score = 4 */
    const [obsA] = await db
      .insert(observations)
      .values({
        schoolId:           SCHOOL_A_ID,
        observedEmployeeId: null,
        rubricSetId:        SCHOOL_RUBRIC_SET_ID,
        observerEmployeeId: null,
        date:               "2025-06-01",
        observer:           "Coach Cross-School Test A",
        status:             "published",
        target:             "SCHOOL",
      })
      .returning({ id: observations.id });
    assert.ok(obsA, "Failed to insert School A test observation");
    obsSchoolAId = obsA.id;
    createdObsIds.push(obsA.id);

    const [scoreA] = await db
      .insert(observationScores)
      .values({ observationId: obsA.id, domainSlug: TEST_DOMAIN_SLUG, score: 4 })
      .returning({ id: observationScores.id });
    assert.ok(scoreA, "Failed to insert School A score");
    createdScoreIds.push(scoreA.id);

    /* Insert a SCHOOL-target observation for School B with score = 2 (distinctly different) */
    const [obsB] = await db
      .insert(observations)
      .values({
        schoolId:           SCHOOL_B_ID,
        observedEmployeeId: null,
        rubricSetId:        SCHOOL_RUBRIC_SET_ID,
        observerEmployeeId: null,
        date:               "2025-06-01",
        observer:           "Coach Cross-School Test B",
        status:             "published",
        target:             "SCHOOL",
      })
      .returning({ id: observations.id });
    assert.ok(obsB, "Failed to insert School B test observation");
    obsSchoolBId = obsB.id;
    createdObsIds.push(obsB.id);

    const [scoreB] = await db
      .insert(observationScores)
      .values({ observationId: obsB.id, domainSlug: TEST_DOMAIN_SLUG, score: 2 })
      .returning({ id: observationScores.id });
    assert.ok(scoreB, "Failed to insert School B score");
    createdScoreIds.push(scoreB.id);

    /* Login as Coach A */
    coachAJar = await loginAs(COACH_A_EID);
  });

  after(async () => {
    /* Scores first (FK child), then observations, then rubric schema, then people */
    if (createdScoreIds.length > 0) {
      await db.delete(observationScores).where(inArray(observationScores.id, createdScoreIds)).catch(() => {});
    }
    for (const id of createdObsIds) {
      await db.delete(observations).where(eq(observations.id, id)).catch(() => {});
    }
    if (createdDomainId !== null) {
      await db.delete(rubricDomains).where(eq(rubricDomains.id, createdDomainId)).catch(() => {});
    }
    if (createdCategoryId !== null) {
      await db.delete(rubricCategories).where(eq(rubricCategories.id, createdCategoryId)).catch(() => {});
    }
    if (createdRubricSetId !== null) {
      await db.delete(rubricSets).where(eq(rubricSets.id, createdRubricSetId)).catch(() => {});
    }
    await db.delete(people).where(inArray(people.employeeId, ALL_TEST_EIDS)).catch(() => {});
  });

  /* 1 ── COACH GET /observations/:id cross-school → 403 ───────────────────── */

  test("1 — COACH cannot GET a SCHOOL-target observation from another school", async () => {
    const res = await request(
      "GET",
      `/observations/${obsSchoolBId}`,
      undefined,
      coachAJar,
    );
    assert.equal(
      res.status,
      403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 2 ── COACH GET /observations/:id own school → 200 ────────────────────── */

  test("2 — COACH can GET a SCHOOL-target observation from their own school", async () => {
    const res = await request(
      "GET",
      `/observations/${obsSchoolAId}`,
      undefined,
      coachAJar,
    );
    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 3 ── COACH network-averages for SCHOOL-target rubric → own school only ── */

  test("3 — COACH /network-averages for SCHOOL-target rubric reflects only own school observations", async () => {
    const res = await request(
      "GET",
      `/action-center/network-averages?rubricSet=${SCHOOL_RUBRIC_SET_SLUG}`,
      undefined,
      coachAJar,
    );
    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const body = res.body as { domainAverages: Record<string, number | null> };
    assert.ok(body.domainAverages, "Response should have domainAverages");

    const avg = body.domainAverages[TEST_DOMAIN_SLUG];
    assert.ok(avg !== undefined, `domainAverages should contain slug '${TEST_DOMAIN_SLUG}'`);

    /* School A has score=4, School B has score=2. If cross-school leak occurs the average
       would be (4+2)/2 = 3. If correctly scoped to School A it should be 4. */
    assert.equal(
      avg,
      4,
      `Expected average 4 (School A only), got ${avg}. ` +
      `A value of 3 indicates cross-school data is being included.`,
    );
  });

  /* 4 ── COACH rescore-queue → School B person excluded ──────────────────── */

  test("4 — COACH /action-center/rescore-queue contains only own-school people", async () => {
    const res = await request("GET", "/action-center/rescore-queue", undefined, coachAJar);
    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.ok(Array.isArray(res.body), "Response should be an array");

    const rows = res.body as Array<{ employeeId: string }>;
    const returnedIds = rows.map((r) => r.employeeId);

    /* School A person needing rescore must be present */
    assert.ok(
      returnedIds.includes(RESCORE_PERSON_A_EID),
      `Expected School A person (${RESCORE_PERSON_A_EID}) in rescore-queue but it was missing. ` +
      `Returned IDs: ${JSON.stringify(returnedIds)}`,
    );

    /* School B person must be absent — cross-school data leak would expose them */
    assert.ok(
      !returnedIds.includes(RESCORE_PERSON_B_EID),
      `School B person (${RESCORE_PERSON_B_EID}) must NOT appear in Coach A's rescore-queue. ` +
      `Cross-school data is leaking. Returned IDs: ${JSON.stringify(returnedIds)}`,
    );
  });

  /* 5 ── COACH overdue-observations → School B person excluded ────────────── */

  test("5 — COACH /action-center/overdue-observations contains only own-school people", async () => {
    const res = await request("GET", "/action-center/overdue-observations", undefined, coachAJar);
    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.ok(Array.isArray(res.body), "Response should be an array");

    const rows = res.body as Array<{ employeeId: string }>;
    const returnedIds = rows.map((r) => r.employeeId);

    /* School A overdue person must be present (never observed, includeInFeedbackTracker=true) */
    assert.ok(
      returnedIds.includes(OVERDUE_PERSON_A_EID),
      `Expected School A person (${OVERDUE_PERSON_A_EID}) in overdue-observations but it was missing. ` +
      `Returned IDs: ${JSON.stringify(returnedIds)}`,
    );

    /* School B overdue person must be absent — cross-school data leak would expose them */
    assert.ok(
      !returnedIds.includes(OVERDUE_PERSON_B_EID),
      `School B person (${OVERDUE_PERSON_B_EID}) must NOT appear in Coach A's overdue-observations. ` +
      `Cross-school data is leaking. Returned IDs: ${JSON.stringify(returnedIds)}`,
    );
  });
});

/* Ensure pool closes when done so the process exits */
process.on("exit", () => { pool.end().catch(() => {}); });
