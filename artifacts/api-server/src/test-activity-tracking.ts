/**
 * Integration tests for activity recording (backlog #21).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:activity-tracking
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * The unit tests in test-activity-recording.ts cover the date boundary and the
 * throttle. These cover the things only a live server can show: that the hook
 * is actually wired into the request path at all, that a day is one row no
 * matter how many requests, and that impersonation credits the admin rather
 * than the person being impersonated.
 *
 * Every person here is created by the test with a timestamped employee id, so
 * no row can pre-exist and a passing assertion means the row was written by
 * this run rather than by an earlier one.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools, schoolYears, assignments, userActivityDays } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP   = Date.now();
const ADM_EID = `TST_ACT_ADM_${STAMP}`;
const TGT_EID = `TST_ACT_TGT_${STAMP}`;
const ALL     = [ADM_EID, TGT_EID];

type Jar = { cookieHeader: string };

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ employeeId }),
  });
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  return { cookieHeader: res.headers.get("set-cookie")!.split(";")[0]! };
}

async function request(method: string, path: string, body: unknown, jar: Jar) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: jar.cookieHeader },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status };
}

/** Rows this person has, newest first. */
async function activityRows(employeeId: string) {
  return db
    .select({
      activityDate: userActivityDays.activityDate,
      signInCount:  userActivityDays.signInCount,
    })
    .from(userActivityDays)
    .where(eq(userActivityDays.employeeId, employeeId));
}

/*
 * recordActivity is fire-and-forget by design: it sits on the hot path for
 * every authenticated request, so it must never delay or fail one. The
 * consequence is that a request can return before its row is committed, and a
 * test that queries immediately races the write. That is a property of the
 * design, not a defect — so the tests wait rather than the code changing.
 */

/** Poll until the expected number of rows exists, or give up and return what is there. */
async function waitForRowCount(employeeId: string, expected: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let rows = await activityRows(employeeId);
  while (rows.length !== expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    rows = await activityRows(employeeId);
  }
  return rows;
}

/** Give any in-flight write time to land, before asserting one did NOT happen. */
async function settle(ms = 500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

let admJar: Jar;

describe("Activity recording", () => {
  before(async () => {
    const [ho] = await db.select({ id: schools.id })
      .from(schools).where(eq(schools.isHomeOffice, true)).limit(1);
    assert.ok(ho, "Need a Home Office school");

    const [school] = await db.select({ id: schools.id })
      .from(schools).where(and(eq(schools.isHomeOffice, false), eq(schools.isActive, true))).limit(1);
    assert.ok(school, "Need a non-home-office school");

    const [year] = await db.select({ id: schoolYears.id })
      .from(schoolYears).where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");

    await db.insert(people).values([
      { employeeId: ADM_EID, firstName: "Test", lastName: "ActAdm", email: `${ADM_EID}@example.com`,
        role: "NETWORK_ADMIN", schoolId: ho.id, isActive: true, includeInFeedbackTracker: false },
      { employeeId: TGT_EID, firstName: "Test", lastName: "ActTgt", email: `${TGT_EID}@example.com`,
        role: "COACH", schoolId: school.id, isActive: true, includeInFeedbackTracker: false },
    ]).onConflictDoNothing();

    /* The target needs an open assignment in the active year or every request
       made while impersonating them 403s on checkActiveThisYear. */
    await db.insert(assignments).values([
      { userId: TGT_EID, role: "COACH", schoolId: school.id, schoolYearId: year.id,
        startDate: "2025-08-01", endDate: null },
    ]).onConflictDoNothing();

    admJar = await loginAs(ADM_EID);
  });

  after(async () => {
    /* user_activity_days cascades from people, so deleting the people is
       enough — but delete explicitly so a failure names this table. */
    await db.delete(userActivityDays).where(inArray(userActivityDays.employeeId, ALL)).catch(() => {});
    await db.delete(assignments).where(inArray(assignments.userId, ALL)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — an authenticated request records a day of activity", async () => {
    const before = await activityRows(ADM_EID);
    assert.equal(before.length, 0, "fixture is fresh, so nothing should exist yet");

    const res = await request("GET", "/auth/me", undefined, admJar);
    assert.equal(res.status, 200);

    const rows = await waitForRowCount(ADM_EID, 1);
    assert.equal(rows.length, 1, "one authenticated request should record exactly one day");
  });

  test("2 — a day is one row however many requests are made", async () => {
    /* The hook runs on every authenticated request. Without the throttle this
       would be a write per request, which is the reason the throttle exists. */
    for (let i = 0; i < 5; i++) {
      await request("GET", "/auth/me", undefined, admJar);
    }
    /* Settle rather than poll: polling for 1 would pass on the first check
       whether or not the other four wrote anything. The point is that they
       did not, so every write has to be given time to land first. */
    await settle();
    const rows = await activityRows(ADM_EID);
    assert.equal(rows.length, 1, `expected still one row, got ${rows.length}`);
  });

  test("3 — dev-login does not inflate sign_in_count", async () => {
    /* Only the Google callback increments it. Activity on an existing session
       must leave it alone, or "how often are people re-authenticating" turns
       into a second, worse copy of the request count. */
    const rows = await activityRows(ADM_EID);
    assert.equal(rows[0]!.signInCount, 0);
  });

  test("4 — impersonation credits the admin, not the impersonated person", async () => {
    /* deserializeUser runs BEFORE applyImpersonation swaps req.user, so the
       real user is the one recorded. If this ever fails, a usage report would
       be crediting activity to people who had no part in it — and the fix is
       to look at where the hook sits, not at the report. */
    const targetBefore = await activityRows(TGT_EID);
    assert.equal(targetBefore.length, 0, "target has not used Catalyst at all");

    const start = await request("POST", "/auth/impersonate", { employeeId: TGT_EID }, admJar);
    assert.equal(start.status, 200, "admin should be able to impersonate the target");

    await request("GET", "/auth/me", undefined, admJar);
    await request("GET", "/auth/me", undefined, admJar);

    await request("POST", "/auth/stop-impersonating", {}, admJar);

    await settle();
    const targetAfter = await activityRows(TGT_EID);
    assert.equal(
      targetAfter.length, 0,
      "the impersonated person was credited with activity they had no part in",
    );

    const adminAfter = await activityRows(ADM_EID);
    assert.equal(adminAfter.length, 1, "the admin's own day should still be recorded, once");
  });
});
