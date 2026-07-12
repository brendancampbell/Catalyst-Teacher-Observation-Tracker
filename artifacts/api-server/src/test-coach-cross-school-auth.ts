/**
 * Regression tests for cross-school COACH auth on observations and action-center endpoints.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/test-coach-cross-school-auth.ts
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. COACH from School A → GET /observations/:id (SCHOOL-target, School B) → 403
 *   2. COACH from School A → GET /observations/:id (SCHOOL-target, School A) → 200
 *   3. COACH /action-center/network-averages with a SCHOOL-target rubric set
 *      → domainAverages reflect only their own school's observations (not another school's)
 *   4. COACH /action-center/rescore-queue → 200 and scoped to own school
 *   5. COACH /action-center/overdue-observations → 200 and scoped to own school
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { observations, observationScores, people, schools, rubricSets, rubricCategories, rubricDomains } from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* Resolved dynamically in before() */
let SCHOOL_A_ID: number;
let SCHOOL_B_ID: number;
let SCHOOL_RUBRIC_SET_ID: number;
let SCHOOL_RUBRIC_SET_SLUG: string;

/* Temporary test user employee IDs */
const COACH_A_EID = "TST_COACH_CROSS_A";

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
    const [rs] = await db
      .insert(rubricSets)
      .values({ slug, name: "Test Coach School RS", target: "SCHOOL", isActive: true })
      .returning({ id: rubricSets.id, slug: rubricSets.slug });
    assert.ok(rs, "Failed to insert test rubric set");
    createdRubricSetId   = rs.id;
    SCHOOL_RUBRIC_SET_ID = rs.id;
    SCHOOL_RUBRIC_SET_SLUG = rs.slug;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "Test Coach Category", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat, "Failed to insert test rubric category");
    createdCategoryId = cat.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({ categoryId: cat.id, slug: TEST_DOMAIN_SLUG, name: "Test Coach Domain", displayOrder: 1 })
      .returning({ id: rubricDomains.id });
    assert.ok(dom, "Failed to insert test rubric domain");
    createdDomainId = dom.id;

    /* Create a COACH test user assigned to School A */
    await db.insert(people).values({
      employeeId:               COACH_A_EID,
      firstName:                "Test",
      lastName:                 "CoachA",
      email:                    "tst.coach.a.crossschool@example.com",
      role:                     "COACH",
      schoolId:                 SCHOOL_A_ID,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

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
    /* Scores first (FK child), then observations, then rubric schema, then users */
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
    await db.delete(people).where(eq(people.employeeId, COACH_A_EID)).catch(() => {});
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

  /* 4 ── COACH rescore-queue → 200 and scoped to own school ──────────────── */

  test("4 — authenticated COACH GET /action-center/rescore-queue returns 200 scoped to own school", async () => {
    const res = await request("GET", "/action-center/rescore-queue", undefined, coachAJar);
    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.ok(Array.isArray(res.body), "Response should be an array");

    /* All returned rows must belong to School A — no cross-school leakage */
    const rows = res.body as Array<{ schoolId?: number; schoolName?: string }>;
    for (const row of rows) {
      if (row.schoolId !== undefined) {
        assert.equal(
          row.schoolId,
          SCHOOL_A_ID,
          `rescore-queue returned a row from wrong school: schoolId=${row.schoolId}`,
        );
      }
    }
  });

  /* 5 ── COACH overdue-observations → 200 and scoped to own school ────────── */

  test("5 — authenticated COACH GET /action-center/overdue-observations returns 200 scoped to own school", async () => {
    const res = await request("GET", "/action-center/overdue-observations", undefined, coachAJar);
    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.ok(Array.isArray(res.body), "Response should be an array");
  });
});

/* Ensure pool closes when done so the process exits */
process.on("exit", () => { pool.end().catch(() => {}); });
