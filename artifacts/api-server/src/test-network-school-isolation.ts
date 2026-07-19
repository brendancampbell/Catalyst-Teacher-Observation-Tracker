/**
 * Regression tests for network-user school isolation on Action Center and AI endpoints.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-network-school-isolation.ts
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios
 * ─────────
 * Group A — Invalid / nonexistent school IDs (global admin with null schoolId)
 *   1. GET /action-center/rescore-queue       ?schoolId=<nonexistent> → 403
 *   2. GET /action-center/overdue-observations?schoolId=<nonexistent> → 403
 *   3. GET /action-steps/overdue             ?schoolId=<nonexistent> → 403
 *   4. GET /ai/insights                      ?schoolId=<nonexistent> → 403
 *   5. GET /ai/calibration-flags             ?schoolId=<nonexistent> → 403
 *   6. POST /ai/chat  (body schoolId=<nonexistent>) → 403
 *   7. POST /ai/chat/stream (body schoolId=<nonexistent>) → 403
 *   8. POST /ai/analysis    (body schoolId=<nonexistent>) → 403
 *
 * Group B — Region-based isolation (NETWORK user assigned to region A school)
 *   9.  NETWORK user (region A) accessing own region school → 200
 *  10.  NETWORK user (region A) accessing region B school → 403
 *  11.  /ai/chat/stream with cross-region school → 403 (stream-specific block)
 *  12.  /ai/analysis  with cross-region school → 403
 *
 * Group C — AI context data isolation (global admin, school-scoped data)
 *  13.  GET /ai/insights?schoolId=<school A> yields avg=4 (Teacher A only, score 4)
 *       confirming Teacher B (school B, score 1) is NOT included in the AI context.
 *  14.  GET /action-center/rescore-queue?schoolId=<valid school A> → 200 (positive control)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  people, schools, observations, observationScores,
  rubricSets, rubricCategories, rubricDomains, schoolYears,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* A schoolId that is guaranteed not to exist */
const NONEXISTENT_SCHOOL_ID = 999_999_999;

/* Created in before() — use different regions for cross-region tests */
let SCHOOL_A_ID: number;   /* region = "Boston" */
let SCHOOL_B_ID: number;   /* region = "NYC"    */

const GLOBAL_ADMIN_EID   = "TST_NET_ISOL_GLOBAL";   /* null schoolId */
const REGIONAL_ADMIN_EID = "TST_NET_ISOL_REGIONAL"; /* schoolId = SCHOOL_A_ID */
const TEACHER_A_EID      = "TST_NET_ISOL_TCH_A";    /* school A */
const TEACHER_B_EID      = "TST_NET_ISOL_TCH_B";    /* school B */

const TEST_DOMAIN_SLUG = "tst_net_isol_domain";
const SCHOOL_A_ABBREV  = "TST-NISOLA";
const SCHOOL_B_ABBREV  = "TST-NISOLB";

const createdObsIds:   number[] = [];
const createdScoreIds: number[] = [];
let createdRubricSetId:  number | null = null;
let createdCategoryId:   number | null = null;
let createdDomainId:     number | null = null;
let createdSchoolAId:    number | null = null;
let createdSchoolBId:    number | null = null;

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

/** Read only the status from a stream endpoint (no body parsing needed) */
async function streamStatus(body: object, jar: Jar): Promise<number> {
  const res = await fetch(`${BASE}/ai/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": jar.cookieHeader },
    body: JSON.stringify(body),
  });
  /* Consume and ignore the body to avoid dangling connections */
  await res.text().catch(() => {});
  return res.status;
}

/* ── Test state ───────────────────────────────────────────────────────────── */

let globalAdminJar:   Jar;
let regionalAdminJar: Jar;

describe("Network school isolation — Action Center and AI endpoints", () => {
  before(async () => {
    /* Create two dedicated test schools in different regions */
    const [schA] = await db
      .insert(schools)
      .values({
        displayName:  "Test School A (Net Isolation)",
        fullName:     "Test School A Full (Net Isolation)",
        abbreviation: SCHOOL_A_ABBREV,
        region:       "Boston",
        gradeSpan:    "MS",
        isActive:     true,
        isArchived:   false,
        isHomeOffice: false,
      })
      .returning({ id: schools.id });
    assert.ok(schA, "Failed to create School A");
    SCHOOL_A_ID = schA.id;
    createdSchoolAId = schA.id;

    const [schB] = await db
      .insert(schools)
      .values({
        displayName:  "Test School B (Net Isolation)",
        fullName:     "Test School B Full (Net Isolation)",
        abbreviation: SCHOOL_B_ABBREV,
        region:       "NYC",
        gradeSpan:    "HS",
        isActive:     true,
        isArchived:   false,
        isHomeOffice: false,
      })
      .returning({ id: schools.id });
    assert.ok(schB, "Failed to create School B");
    SCHOOL_B_ID = schB.id;
    createdSchoolBId = schB.id;

    /* Create a TEACHER-target rubric set with one domain */
    const slug = `tst-net-isol-rs-${Date.now()}`;
    const [activeYear] = await db.select({ id: schoolYears.id }).from(schoolYears).where(eq(schoolYears.status, "active")).limit(1);
    const activeSchoolYearId = activeYear!.id;

    const [rs] = await db
      .insert(rubricSets)
      .values({ slug, name: "Test Net Isolation RS", target: "TEACHER", isActive: true, schoolYearId: activeSchoolYearId })
      .returning({ id: rubricSets.id });
    assert.ok(rs, "Failed to insert test rubric set");
    createdRubricSetId = rs.id;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "Test Category", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat, "Failed to insert test rubric category");
    createdCategoryId = cat.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({ categoryId: cat.id, rubricSetId: rs.id, schoolYearId: activeSchoolYearId, slug: TEST_DOMAIN_SLUG, name: "Test Domain", displayOrder: 1 })
      .returning({ id: rubricDomains.id });
    assert.ok(dom, "Failed to insert test rubric domain");
    createdDomainId = dom.id;

    /* Create test people */
    await db.insert(people).values([
      /* Global NETWORK_ADMIN — no schoolId, sees all schools */
      {
        employeeId:               GLOBAL_ADMIN_EID,
        firstName:                "Global",
        lastName:                 "NetAdmin",
        email:                    "tst.net.isol.global@example.com",
        role:                     "NETWORK_ADMIN",
        schoolId:                 null,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      /* Regional NETWORK_ADMIN — assigned to School A (Boston region) */
      {
        employeeId:               REGIONAL_ADMIN_EID,
        firstName:                "Regional",
        lastName:                 "NetAdmin",
        email:                    "tst.net.isol.regional@example.com",
        role:                     "NETWORK_ADMIN",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      /* Teacher A — School A (Boston) */
      {
        employeeId:               TEACHER_A_EID,
        firstName:                "TeacherA",
        lastName:                 "NetIsol",
        email:                    "tst.net.isol.tch.a@example.com",
        role:                     "COACH",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: true,
      },
      /* Teacher B — School B (NYC) */
      {
        employeeId:               TEACHER_B_EID,
        firstName:                "TeacherB",
        lastName:                 "NetIsol",
        email:                    "tst.net.isol.tch.b@example.com",
        role:                     "COACH",
        schoolId:                 SCHOOL_B_ID,
        isActive:                 true,
        includeInFeedbackTracker: true,
      },
    ]).onConflictDoNothing();

    /* Observation + score for Teacher A (School A) — score = 4 */
    const [obsA] = await db
      .insert(observations)
      .values({
        schoolYearId:                1,
        schoolId:           SCHOOL_A_ID,
        observedEmployeeId: TEACHER_A_EID,
        rubricSetId:        rs.id,
        observerEmployeeId: null,
        date:               "2025-06-01",
        status:             "published",
        target:             "TEACHER",
      })
      .returning({ id: observations.id });
    assert.ok(obsA, "Failed to insert School A observation");
    createdObsIds.push(obsA.id);

    const [scoreA] = await db
      .insert(observationScores)
      .values({ observationId: obsA.id, domainSlug: TEST_DOMAIN_SLUG, score: 4 })
      .returning({ id: observationScores.id });
    assert.ok(scoreA, "Failed to insert School A score");
    createdScoreIds.push(scoreA.id);

    /* Observation + score for Teacher B (School B) — score = 1 */
    const [obsB] = await db
      .insert(observations)
      .values({
        schoolYearId:                1,
        schoolId:           SCHOOL_B_ID,
        observedEmployeeId: TEACHER_B_EID,
        rubricSetId:        rs.id,
        observerEmployeeId: null,
        date:               "2025-06-01",
        status:             "published",
        target:             "TEACHER",
      })
      .returning({ id: observations.id });
    assert.ok(obsB, "Failed to insert School B observation");
    createdObsIds.push(obsB.id);

    const [scoreB] = await db
      .insert(observationScores)
      .values({ observationId: obsB.id, domainSlug: TEST_DOMAIN_SLUG, score: 1 })
      .returning({ id: observationScores.id });
    assert.ok(scoreB, "Failed to insert School B score");
    createdScoreIds.push(scoreB.id);

    /* Log in as both test users */
    globalAdminJar   = await loginAs(GLOBAL_ADMIN_EID);
    regionalAdminJar = await loginAs(REGIONAL_ADMIN_EID);
  });

  after(async () => {
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
    await db.delete(people).where(
      inArray(people.employeeId, [GLOBAL_ADMIN_EID, REGIONAL_ADMIN_EID, TEACHER_A_EID, TEACHER_B_EID]),
    ).catch(() => {});
    /* Remove test schools last (people FK already gone) */
    if (createdSchoolBId !== null) {
      await db.delete(schools).where(eq(schools.id, createdSchoolBId)).catch(() => {});
    }
    if (createdSchoolAId !== null) {
      await db.delete(schools).where(eq(schools.id, createdSchoolAId)).catch(() => {});
    }
  });

  /* ── Group A: Nonexistent school → 403 on every endpoint ────────────────── */

  test("1 — global NETWORK_ADMIN, nonexistent schoolId → 403 on /action-center/rescore-queue", async () => {
    const res = await request("GET", `/action-center/rescore-queue?schoolId=${NONEXISTENT_SCHOOL_ID}`, undefined, globalAdminJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("2 — global NETWORK_ADMIN, nonexistent schoolId → 403 on /action-center/overdue-observations", async () => {
    const res = await request("GET", `/action-center/overdue-observations?schoolId=${NONEXISTENT_SCHOOL_ID}`, undefined, globalAdminJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("3 — global NETWORK_ADMIN, nonexistent schoolId → 403 on /action-steps/overdue", async () => {
    const res = await request("GET", `/action-steps/overdue?schoolId=${NONEXISTENT_SCHOOL_ID}`, undefined, globalAdminJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("4 — global NETWORK_ADMIN, nonexistent schoolId → 403 on GET /ai/insights", async () => {
    const res = await request("GET", `/ai/insights?schoolId=${NONEXISTENT_SCHOOL_ID}`, undefined, globalAdminJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("5 — global NETWORK_ADMIN, nonexistent schoolId → 403 on GET /ai/calibration-flags", async () => {
    const res = await request("GET", `/ai/calibration-flags?schoolId=${NONEXISTENT_SCHOOL_ID}`, undefined, globalAdminJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("6 — global NETWORK_ADMIN, nonexistent schoolId → 403 on POST /ai/chat", async () => {
    const res = await request("POST", "/ai/chat", { message: "hello", schoolId: NONEXISTENT_SCHOOL_ID }, globalAdminJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("7 — global NETWORK_ADMIN, nonexistent schoolId → 403 on POST /ai/chat/stream", async () => {
    const status = await streamStatus({ message: "hello", schoolId: NONEXISTENT_SCHOOL_ID }, globalAdminJar);
    assert.equal(status, 403, `Expected 403 from stream with nonexistent school, got ${status}`);
  });

  test("8 — global NETWORK_ADMIN, nonexistent schoolId → 403 on POST /ai/analysis", async () => {
    const res = await request("POST", "/ai/analysis", { rubricSetSlug: "Q1", schoolId: NONEXISTENT_SCHOOL_ID }, globalAdminJar);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* ── Group B: Region-based isolation ────────────────────────────────────── */

  test("9 — regional NETWORK_ADMIN (Boston) → 200 when accessing same-region school (School A)", async () => {
    const res = await request("GET", `/action-center/rescore-queue?schoolId=${SCHOOL_A_ID}`, undefined, regionalAdminJar);
    assert.equal(
      res.status, 200,
      `Expected 200 for own-region school, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.ok(Array.isArray(res.body), "Expected an array response");
  });

  test("10 — regional NETWORK_ADMIN (Boston) → 403 when accessing cross-region school (School B / NYC)", async () => {
    const res = await request("GET", `/action-center/rescore-queue?schoolId=${SCHOOL_B_ID}`, undefined, regionalAdminJar);
    assert.equal(
      res.status, 403,
      `Expected 403 for cross-region school, got ${res.status}: ${JSON.stringify(res.body)}. ` +
      `This means a NETWORK_ADMIN is leaking into another region's data.`,
    );
  });

  test("11 — regional NETWORK_ADMIN (Boston) → 403 on /ai/chat/stream with cross-region school (NYC)", async () => {
    const status = await streamStatus({ message: "hello", schoolId: SCHOOL_B_ID }, regionalAdminJar);
    assert.equal(
      status, 403,
      `Expected 403 from AI chat stream with cross-region school, got ${status}. ` +
      `This means the AI context builder would load teacher data from a foreign region.`,
    );
  });

  test("12 — regional NETWORK_ADMIN (Boston) → 403 on /ai/analysis with cross-region school (NYC)", async () => {
    const res = await request("POST", "/ai/analysis", { rubricSetSlug: "Q1", schoolId: SCHOOL_B_ID }, regionalAdminJar);
    assert.equal(
      res.status, 403,
      `Expected 403 for AI analysis with cross-region school, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* ── Group C: AI context data isolation ─────────────────────────────────── */

  test("13 — global NETWORK_ADMIN: /ai/insights scoped to School A excludes School B teacher data", async () => {
    /* Teacher A (School A) has score=4; Teacher B (School B) has score=1.
       If scoping is correct, avg for the test domain = 4.
       If School B leaks into the AI context, avg = (4+1)/2 = 2.5.            */
    const res = await request("GET", `/ai/insights?schoolId=${SCHOOL_A_ID}`, undefined, globalAdminJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    const body = res.body as {
      topStrength: { domain: string; avg: number } | null;
      topGrowth:   { domain: string; avg: number } | null;
    };
    const avg = body.topStrength?.avg ?? body.topGrowth?.avg;
    assert.ok(avg !== undefined && avg !== null, "Expected a domain average in the insights response");
    assert.equal(
      avg, 4,
      `Expected avg=4 (School A only, Teacher A score), got ${avg}. ` +
      `A value < 4 indicates School B teacher data leaked into the AI context.`,
    );
  });

  test("14 — global NETWORK_ADMIN with valid schoolId → 200 (positive control)", async () => {
    const res = await request("GET", `/action-center/rescore-queue?schoolId=${SCHOOL_A_ID}`, undefined, globalAdminJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(Array.isArray(res.body), "Expected an array response");
  });
});

/* Ensure pool closes when done so the process exits */
process.on("exit", () => { pool.end().catch(() => {}); });
