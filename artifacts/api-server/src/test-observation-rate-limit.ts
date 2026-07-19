/**
 * Regression test: rate limiter on PUT /api/observations/:id stops ID enumeration.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:rate-limit-observations
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * The rate limiter allows 30 PUT requests per user per 15-minute window.
 *
 * Scenarios:
 *   1. Requests 1–30 from the same authenticated user → all return non-429
 *   2. Request 31 from the same user → 429 Too Many Requests
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  observations, people, schools, rubricSets,
  rubricCategories, rubricDomains, schoolYears,
} from "@workspace/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* Unique employee ID — ensures a fresh rate-limit bucket every run */
const ADMIN_EID  = `TST_RATE_LIMIT_OBS_ADMIN_${Date.now()}`;
const TEACHER_EID = `TST_RATE_LIMIT_OBS_TEACHER_${Date.now()}`;

/* Track created IDs for cleanup */
let createdObsId: number | null = null;
let createdRubricSetId: number | null = null;
let createdCategoryId: number | null = null;
let createdDomainId: number | null = null;

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

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

/* ── Test state ───────────────────────────────────────────────────────────── */

let adminJar: Jar;

describe("Observation mutation rate limiter — PUT /api/observations/:id", () => {
  before(async () => {
    /* Resolve a school */
    const [firstSchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(1);
    assert.ok(firstSchool, "Need at least 1 school in the DB to run this test");
    const SCHOOL_ID = firstSchool.id;

    /* Resolve an active school year */
    const [activeYear] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);
    assert.ok(activeYear, "Need at least 1 active school year in the DB to run this test");
    const activeSchoolYearId = activeYear.id;

    /* Create a minimal rubric set so the observation has a valid rubricSetId */
    const rsSlug = `tst-rate-limit-rs-${Date.now()}`;
    const [rs] = await db
      .insert(rubricSets)
      .values({ slug: rsSlug, name: "Test Rate Limit RS", target: "TEACHER", isActive: true, schoolYearId: activeSchoolYearId })
      .returning({ id: rubricSets.id });
    assert.ok(rs, "Failed to insert test rubric set");
    createdRubricSetId = rs.id;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "Test Rate Limit Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat, "Failed to insert test rubric category");
    createdCategoryId = cat.id;

    const domSlug = `tst-rate-limit-dom-${Date.now()}`;
    const [dom] = await db
      .insert(rubricDomains)
      .values({ categoryId: cat.id, rubricSetId: rs.id, schoolYearId: activeSchoolYearId, slug: domSlug, name: "Test Domain", displayOrder: 1 })
      .returning({ id: rubricDomains.id });
    assert.ok(dom, "Failed to insert test rubric domain");
    createdDomainId = dom.id;

    /* Create test users */
    await db.insert(people).values({
      employeeId:               ADMIN_EID,
      firstName:                "Test",
      lastName:                 "RateLimitAdmin",
      email:                    `tst.rate.limit.admin.${Date.now()}@example.com`,
      role:                     "NETWORK_ADMIN",
      schoolId:                 null,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

    await db.insert(people).values({
      employeeId:               TEACHER_EID,
      firstName:                "Test",
      lastName:                 "RateLimitTeacher",
      email:                    `tst.rate.limit.teacher.${Date.now()}@example.com`,
      role:                     "NO_ACCESS",
      schoolId:                 SCHOOL_ID,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

    /* Create the observation the PUT requests will target.
       Owned by ADMIN_EID as a draft so isDraftEdit=true → no extra auth checks. */
    const [obs] = await db
      .insert(observations)
      .values({
        schoolYearId:       activeSchoolYearId,
        observedEmployeeId: TEACHER_EID,
        schoolId:           SCHOOL_ID,
        rubricSetId:        rs.id,
        observerEmployeeId: ADMIN_EID,
        date:               "2025-07-01",
        status:             "draft",
        target:             "TEACHER",
      })
      .returning({ id: observations.id });
    assert.ok(obs, "Failed to create test observation");
    createdObsId = obs.id;

    /* Login as the NETWORK_ADMIN — fresh employee ID = fresh rate-limit bucket */
    adminJar = await loginAs(ADMIN_EID);
  });

  after(async () => {
    if (createdObsId !== null) {
      await db.delete(observations).where(eq(observations.id, createdObsId)).catch(() => {});
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
    await db.delete(people).where(inArray(people.employeeId, [ADMIN_EID, TEACHER_EID])).catch(() => {});
  });

  /* ── Test 1: requests 1–30 are not blocked ──────────────────────────────── */

  test("1 — Requests 1–30 return a non-429 status (rate limit not yet reached)", async () => {
    assert.ok(createdObsId !== null, "Test observation must exist before this test runs");

    const LIMIT = 30;
    for (let i = 1; i <= LIMIT; i++) {
      const res = await request(
        "PUT",
        `/observations/${createdObsId}`,
        { strengths: `rate-limit-probe-${i}` },
        adminJar,
      );
      assert.notEqual(
        res.status,
        429,
        `Request ${i}/${LIMIT} was unexpectedly rate-limited (429). Got status ${res.status}.`,
      );
    }
  });

  /* ── Test 2: request 31 is blocked with 429 ─────────────────────────────── */

  test("2 — Request 31 returns 429 Too Many Requests", async () => {
    assert.ok(createdObsId !== null, "Test observation must exist before this test runs");

    const res = await request(
      "PUT",
      `/observations/${createdObsId}`,
      { strengths: "rate-limit-probe-31" },
      adminJar,
    );
    assert.equal(
      res.status,
      429,
      `Expected 429 on request 31 (rate limit exceeded), but got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });
});

/* Ensure pool closes when done so the process exits */
process.on("exit", () => { pool.end().catch(() => {}); });
