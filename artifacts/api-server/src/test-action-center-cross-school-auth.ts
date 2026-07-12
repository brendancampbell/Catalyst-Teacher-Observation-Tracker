/**
 * Regression tests for cross-school SCHOOL_LEADER auth on action-center endpoints.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/test-action-center-cross-school-auth.ts
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. Unauthenticated GET /action-center/rescore-queue → 401
 *   2. Unauthenticated GET /action-center/overdue-observations → 401
 *   3. Unauthenticated GET /action-center/network-averages → 401
 *   4. SCHOOL_LEADER GET /action-center/network-averages with a SCHOOL-target rubric set
 *      → domainAverages reflect only their own school's observations (not another school's)
 *   5. SCHOOL_LEADER GET /action-center/rescore-queue → 200 (properly authenticated)
 *   6. SCHOOL_LEADER GET /action-center/overdue-observations → 200 (properly authenticated)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { observations, observationScores, people, schools, rubricSets, rubricCategories, rubricDomains } from "@workspace/db/schema";
import { eq, inArray, asc, and } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* Resolved dynamically in before() */
let SCHOOL_A_ID: number;
let SCHOOL_B_ID: number;
let SCHOOL_RUBRIC_SET_ID: number;
let SCHOOL_RUBRIC_SET_SLUG: string;

/* Temporary test user employee IDs */
const LEADER_A_EID = "TST_AC_AUTH_A";
const LEADER_B_EID = "TST_AC_AUTH_B";

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

let leaderAJar: Jar;
let obsAId: number;
let obsBId: number;
const TEST_DOMAIN_SLUG = "tst_ac_domain";

describe("Action-center endpoint auth — SCHOOL_LEADER cross-school protection", () => {
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
    const slug = `tst-ac-school-rs-${Date.now()}`;
    const [rs] = await db
      .insert(rubricSets)
      .values({ slug, name: "Test AC School RS", target: "SCHOOL", isActive: true })
      .returning({ id: rubricSets.id, slug: rubricSets.slug });
    assert.ok(rs, "Failed to insert test rubric set");
    createdRubricSetId   = rs.id;
    SCHOOL_RUBRIC_SET_ID = rs.id;
    SCHOOL_RUBRIC_SET_SLUG = rs.slug;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "Test Category", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat, "Failed to insert test rubric category");
    createdCategoryId = cat.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({ categoryId: cat.id, slug: TEST_DOMAIN_SLUG, name: "Test Domain", displayOrder: 1 })
      .returning({ id: rubricDomains.id });
    assert.ok(dom, "Failed to insert test rubric domain");
    createdDomainId = dom.id;

    /* Create two temporary SCHOOL_LEADER test users */
    await db.insert(people).values([
      {
        employeeId:               LEADER_A_EID,
        firstName:                "Test",
        lastName:                 "AcLeaderA",
        email:                    "tst.ac.leader.a@example.com",
        role:                     "SCHOOL_LEADER",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               LEADER_B_EID,
        firstName:                "Test",
        lastName:                 "AcLeaderB",
        email:                    "tst.ac.leader.b@example.com",
        role:                     "SCHOOL_LEADER",
        schoolId:                 SCHOOL_B_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
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
        observer:           "AC Cross-School Test A",
        status:             "published",
        target:             "SCHOOL",
      })
      .returning({ id: observations.id });
    assert.ok(obsA, "Failed to insert School A test observation");
    obsAId = obsA.id;
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
        observer:           "AC Cross-School Test B",
        status:             "published",
        target:             "SCHOOL",
      })
      .returning({ id: observations.id });
    assert.ok(obsB, "Failed to insert School B test observation");
    obsBId = obsB.id;
    createdObsIds.push(obsB.id);

    const [scoreB] = await db
      .insert(observationScores)
      .values({ observationId: obsB.id, domainSlug: TEST_DOMAIN_SLUG, score: 2 })
      .returning({ id: observationScores.id });
    assert.ok(scoreB, "Failed to insert School B score");
    createdScoreIds.push(scoreB.id);

    /* Login as Leader A */
    leaderAJar = await loginAs(LEADER_A_EID);
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
    await db.delete(people).where(inArray(people.employeeId, [LEADER_A_EID, LEADER_B_EID])).catch(() => {});
  });

  /* 1 ── Unauthenticated rescore-queue → 401 ──────────────────────────────── */

  test("1 — unauthenticated GET /action-center/rescore-queue returns 401", async () => {
    const res = await request("GET", "/action-center/rescore-queue", undefined);
    assert.equal(
      res.status,
      401,
      `Expected 401 without auth, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 2 ── Unauthenticated overdue-observations → 401 ───────────────────────── */

  test("2 — unauthenticated GET /action-center/overdue-observations returns 401", async () => {
    const res = await request("GET", "/action-center/overdue-observations", undefined);
    assert.equal(
      res.status,
      401,
      `Expected 401 without auth, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 3 ── Unauthenticated network-averages → 401 ───────────────────────────── */

  test("3 — unauthenticated GET /action-center/network-averages returns 401", async () => {
    const res = await request("GET", "/action-center/network-averages", undefined);
    assert.equal(
      res.status,
      401,
      `Expected 401 without auth, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 4 ── SCHOOL_LEADER network-averages for SCHOOL-target rubric → own school only ── */

  test("4 — SCHOOL_LEADER /network-averages for SCHOOL-target rubric reflects only own school observations", async () => {
    const res = await request(
      "GET",
      `/action-center/network-averages?rubricSet=${SCHOOL_RUBRIC_SET_SLUG}`,
      undefined,
      leaderAJar,
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

  /* 5 ── SCHOOL_LEADER rescore-queue → 200 ────────────────────────────────── */

  test("5 — authenticated SCHOOL_LEADER GET /action-center/rescore-queue returns 200", async () => {
    const res = await request("GET", "/action-center/rescore-queue", undefined, leaderAJar);
    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.ok(Array.isArray(res.body), "Response should be an array");
  });

  /* 6 ── SCHOOL_LEADER overdue-observations → 200 ─────────────────────────── */

  test("6 — authenticated SCHOOL_LEADER GET /action-center/overdue-observations returns 200", async () => {
    const res = await request("GET", "/action-center/overdue-observations", undefined, leaderAJar);
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
