/**
 * Regression tests for cross-school SCHOOL_LEADER auth on PUT and DELETE
 * /api/observations/:id for SCHOOL-target observations.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/test-observations-cross-school-auth.ts
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. SCHOOL_LEADER from School A → PUT on a SCHOOL-target obs for School B → 403
 *   2. SCHOOL_LEADER from School A → DELETE a SCHOOL-target obs for School B → 403
 *   3. SCHOOL_LEADER from School A → PUT on a SCHOOL-target obs for School A → 200
 *   4. SCHOOL_LEADER from School A → DELETE a SCHOOL-target obs for School A → 200
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { observations, people } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* Two real school IDs that exist in the dev DB */
const SCHOOL_A_ID = 60;
const SCHOOL_B_ID = 61;

/* Rubric set ID that exists in the dev DB */
const RUBRIC_SET_ID = 5;

/* Temporary test user employee IDs — unique enough to avoid clashes */
const LEADER_A_EID = "TST_SL_CROSS_A";
const LEADER_B_EID = "TST_SL_CROSS_B";

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

let leaderAJar: Jar;
let obsOtherSchoolId: number;
let obsOwnSchoolId: number;
const createdObsIds: number[] = [];

describe("SCHOOL_LEADER cross-school auth — SCHOOL-target observations", () => {
  before(async () => {
    /* Create two temporary SCHOOL_LEADER test users with distinct schoolIds */
    await db.insert(people).values([
      {
        employeeId:               LEADER_A_EID,
        firstName:                "Test",
        lastName:                 "LeaderA",
        email:                    "tst.leader.a.crossschool@example.com",
        role:                     "SCHOOL_LEADER",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               LEADER_B_EID,
        firstName:                "Test",
        lastName:                 "LeaderB",
        email:                    "tst.leader.b.crossschool@example.com",
        role:                     "SCHOOL_LEADER",
        schoolId:                 SCHOOL_B_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
    ]).onConflictDoNothing();

    /* Insert a SCHOOL-target observation belonging to School B (the OTHER school) */
    const [obsOther] = await db
      .insert(observations)
      .values({
        schoolId:           SCHOOL_B_ID,
        observedEmployeeId: null,
        rubricSetId:        RUBRIC_SET_ID,
        observerEmployeeId: null,
        date:               "2025-01-01",
        observer:           "Cross-School Test",
        status:             "published",
        target:             "SCHOOL",
      })
      .returning({ id: observations.id });
    assert.ok(obsOther, "Failed to insert cross-school test observation");
    obsOtherSchoolId = obsOther.id;
    createdObsIds.push(obsOther.id);

    /* Insert a SCHOOL-target observation belonging to School A (leaderA's OWN school) */
    const [obsOwn] = await db
      .insert(observations)
      .values({
        schoolId:           SCHOOL_A_ID,
        observedEmployeeId: null,
        rubricSetId:        RUBRIC_SET_ID,
        observerEmployeeId: null,
        date:               "2025-01-01",
        observer:           "Cross-School Test",
        status:             "published",
        target:             "SCHOOL",
      })
      .returning({ id: observations.id });
    assert.ok(obsOwn, "Failed to insert own-school test observation");
    obsOwnSchoolId = obsOwn.id;
    createdObsIds.push(obsOwn.id);

    /* Login as Leader A (schoolId = SCHOOL_A_ID) — session captures schoolId from DB */
    leaderAJar = await loginAs(LEADER_A_EID);
  });

  after(async () => {
    /* Clean up observations not deleted by the tests */
    for (const id of createdObsIds) {
      await db.delete(observations).where(eq(observations.id, id)).catch(() => {});
    }
    /* Clean up temporary test users */
    await db.delete(people).where(inArray(people.employeeId, [LEADER_A_EID, LEADER_B_EID]));
  });

  /* 1 ── PUT cross-school → 403 ─────────────────────────────────────────── */

  test("1 — SCHOOL_LEADER cannot PUT a SCHOOL-target observation from another school", async () => {
    const res = await request(
      "PUT",
      `/observations/${obsOtherSchoolId}`,
      { strengths: "should be blocked" },
      leaderAJar,
    );
    assert.equal(
      res.status,
      403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 2 ── DELETE cross-school → 403 ──────────────────────────────────────── */

  test("2 — SCHOOL_LEADER cannot DELETE a SCHOOL-target observation from another school", async () => {
    const res = await request(
      "DELETE",
      `/observations/${obsOtherSchoolId}`,
      undefined,
      leaderAJar,
    );
    assert.equal(
      res.status,
      403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 3 ── PUT own school → 200 ────────────────────────────────────────────── */

  test("3 — SCHOOL_LEADER can PUT a SCHOOL-target observation in their own school", async () => {
    const res = await request(
      "PUT",
      `/observations/${obsOwnSchoolId}`,
      { strengths: "Great school culture" },
      leaderAJar,
    );
    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 4 ── DELETE own school → 200 ─────────────────────────────────────────── */

  test("4 — SCHOOL_LEADER can DELETE a SCHOOL-target observation in their own school", async () => {
    const res = await request(
      "DELETE",
      `/observations/${obsOwnSchoolId}`,
      undefined,
      leaderAJar,
    );
    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    /* Remove from cleanup list — test deleted it */
    const idx = createdObsIds.indexOf(obsOwnSchoolId);
    if (idx !== -1) createdObsIds.splice(idx, 1);
  });
});

/* Ensure pool closes when done so the process exits */
process.on("exit", () => { pool.end().catch(() => {}); });
