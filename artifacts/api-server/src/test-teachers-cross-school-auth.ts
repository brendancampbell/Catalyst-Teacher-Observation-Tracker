/**
 * Regression tests for GET /api/teachers/:id school scoping.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:teachers-cross-school-auth
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * The bug this guards against:
 *
 *   The route compared schools with `person.schoolId !== currentUser.schoolId`.
 *   That is fail-OPEN — when BOTH sides are null the comparison is false, so a
 *   caller with no school assigned was granted access to every person who also
 *   had no school. The observation query then compounded it: its school filter
 *   was only applied `if (currentUser.schoolId !== null)`, so the same caller
 *   received that person's observations from every school in the network.
 *
 *   Both null states are reachable rather than hypothetical: people.school_id
 *   is nullable and declared onDelete: "set null", so deleting a school nulls
 *   it for everyone assigned to it. And unlike the dashboard, this router is
 *   mounted with requireAuth alone — no enforceSchoolScope in front of it to
 *   reject a school-scoped caller with no school first.
 *
 * Scenarios:
 *   1. SCHOOL_LEADER with NO school → GET a person with NO school → 403
 *   2. SCHOOL_LEADER with NO school → GET a person WITH a school → 403
 *   3. COACH with NO school → GET a person with NO school → 403
 *   4. SCHOOL_LEADER from School A → GET a person at School B → 403
 *   5. SCHOOL_LEADER from School A → GET a person at School A → 200
 *   6. SCHOOL_LEADER from School A → GET a person with NO school → 403
 *   7. NETWORK_ADMIN → GET a person with NO school → 200 (unchanged by the fix)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";
import { inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

let SCHOOL_A_ID: number;
let SCHOOL_B_ID: number;

/* Callers */
const LEADER_NO_SCHOOL_EID = "TST_TCH_SL_NOSCHOOL";
const COACH_NO_SCHOOL_EID  = "TST_TCH_CO_NOSCHOOL";
const LEADER_A_EID         = "TST_TCH_SL_A";
const ADMIN_EID            = "TST_TCH_ADMIN";

/* Targets */
const TARGET_NO_SCHOOL_EID = "TST_TCH_TGT_NOSCHOOL";
const TARGET_SCHOOL_A_EID  = "TST_TCH_TGT_A";
const TARGET_SCHOOL_B_EID  = "TST_TCH_TGT_B";

const ALL_EIDS = [
  LEADER_NO_SCHOOL_EID, COACH_NO_SCHOOL_EID, LEADER_A_EID, ADMIN_EID,
  TARGET_NO_SCHOOL_EID, TARGET_SCHOOL_A_EID, TARGET_SCHOOL_B_EID,
];

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function get(path: string, jar: Jar): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar.cookieHeader) headers["Cookie"] = jar.cookieHeader;
  const res = await fetch(`${BASE}${path}`, { method: "GET", headers });
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ employeeId }),
  });
  const setCookie = res.headers.get("set-cookie");
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: status ${res.status}`);
  assert.ok(setCookie, "dev-login should return a Set-Cookie header");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

let leaderNoSchoolJar: Jar;
let coachNoSchoolJar:  Jar;
let leaderAJar:        Jar;
let adminJar:          Jar;

describe("GET /api/teachers/:id — school scoping", () => {
  before(async () => {
    const twoSchools = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(2);
    assert.equal(twoSchools.length, 2, "Need at least 2 schools in the DB to run this test");
    SCHOOL_A_ID = twoSchools[0]!.id;
    SCHOOL_B_ID = twoSchools[1]!.id;

    await db.insert(people).values([
      {
        employeeId: LEADER_NO_SCHOOL_EID, firstName: "Test", lastName: "LeaderNoSchool",
        email: "tst.tch.sl.noschool@example.com", role: "SCHOOL_LEADER",
        schoolId: null, isActive: true, includeInFeedbackTracker: false,
      },
      {
        employeeId: COACH_NO_SCHOOL_EID, firstName: "Test", lastName: "CoachNoSchool",
        email: "tst.tch.co.noschool@example.com", role: "COACH",
        schoolId: null, isActive: true, includeInFeedbackTracker: false,
      },
      {
        employeeId: LEADER_A_EID, firstName: "Test", lastName: "LeaderA",
        email: "tst.tch.sl.a@example.com", role: "SCHOOL_LEADER",
        schoolId: SCHOOL_A_ID, isActive: true, includeInFeedbackTracker: false,
      },
      {
        employeeId: ADMIN_EID, firstName: "Test", lastName: "Admin",
        email: "tst.tch.admin@example.com", role: "NETWORK_ADMIN",
        schoolId: null, isActive: true, includeInFeedbackTracker: false,
      },
      /* Targets. NO_ACCESS is the normal role for a teacher. */
      {
        employeeId: TARGET_NO_SCHOOL_EID, firstName: "Test", lastName: "TargetNoSchool",
        email: "tst.tch.tgt.noschool@example.com", role: "NO_ACCESS",
        schoolId: null, isActive: true, includeInFeedbackTracker: false,
      },
      {
        employeeId: TARGET_SCHOOL_A_EID, firstName: "Test", lastName: "TargetA",
        email: "tst.tch.tgt.a@example.com", role: "NO_ACCESS",
        schoolId: SCHOOL_A_ID, isActive: true, includeInFeedbackTracker: false,
      },
      {
        employeeId: TARGET_SCHOOL_B_EID, firstName: "Test", lastName: "TargetB",
        email: "tst.tch.tgt.b@example.com", role: "NO_ACCESS",
        schoolId: SCHOOL_B_ID, isActive: true, includeInFeedbackTracker: false,
      },
    ]).onConflictDoNothing();

    leaderNoSchoolJar = await loginAs(LEADER_NO_SCHOOL_EID);
    coachNoSchoolJar  = await loginAs(COACH_NO_SCHOOL_EID);
    leaderAJar        = await loginAs(LEADER_A_EID);
    adminJar          = await loginAs(ADMIN_EID);
  });

  after(async () => {
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS));
    await pool.end().catch(() => {});
  });

  /* 1-3 ── the fail-open case: caller with no school ───────────────────────── */

  test("1 — SCHOOL_LEADER with no school cannot read a person with no school", async () => {
    const res = await get(`/teachers/${TARGET_NO_SCHOOL_EID}`, leaderNoSchoolJar);
    assert.equal(
      res.status, 403,
      `null === null must not grant access. Got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  test("2 — SCHOOL_LEADER with no school cannot read a person with a school", async () => {
    const res = await get(`/teachers/${TARGET_SCHOOL_A_EID}`, leaderNoSchoolJar);
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  test("3 — COACH with no school cannot read a person with no school", async () => {
    const res = await get(`/teachers/${TARGET_NO_SCHOOL_EID}`, coachNoSchoolJar);
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  /* 4-6 ── ordinary school scoping still holds ─────────────────────────────── */

  test("4 — SCHOOL_LEADER cannot read a person from another school", async () => {
    const res = await get(`/teachers/${TARGET_SCHOOL_B_EID}`, leaderAJar);
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  test("5 — SCHOOL_LEADER can read a person from their own school", async () => {
    const res = await get(`/teachers/${TARGET_SCHOOL_A_EID}`, leaderAJar);
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal((res.body as { employeeId?: string }).employeeId, TARGET_SCHOOL_A_EID);
  });

  test("6 — SCHOOL_LEADER cannot read an unattributed person", async () => {
    const res = await get(`/teachers/${TARGET_NO_SCHOOL_EID}`, leaderAJar);
    assert.equal(
      res.status, 403,
      "a record with no school is unattributable and must be denied to school-scoped callers",
    );
  });

  /* 7 ── network scope is unaffected ───────────────────────────────────────── */

  test("7 — NETWORK_ADMIN can still read a person with no school", async () => {
    const res = await get(`/teachers/${TARGET_NO_SCHOOL_EID}`, adminJar);
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  });
});
