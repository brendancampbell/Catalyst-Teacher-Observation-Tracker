/**
 * Integration tests: reactivating somebody puts them back on this year's roster.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:reactivation
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * Reported from production. Somebody deactivated by the rollover was
 * reactivated in the Users tab and still could not sign in: a blank dashboard
 * for a few seconds, then a white screen. Reassigning them to the school they
 * were already in fixed it.
 *
 * isActive and the assignments ledger are two separate gates.
 * checkActiveThisYear() requires an OPEN assignment in the active year for
 * anyone with assignment history, and toggle-active only ever wrote isActive —
 * so the account looked active in the Users tab and 403'd on every API call.
 * /reassign happened to write the missing row, which is why the transfer
 * "fixed" it.
 *
 *   1. Reactivating restores an open assignment in the active year
 *   2. The restored person can actually use the API
 *   3. Somebody with no assignment history has none fabricated
 *   4. An existing open assignment is left alone, not duplicated
 *   5. Deactivating does not write an assignment
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools, schoolYears, assignments } from "@workspace/db/schema";
import { eq, inArray, asc, and, isNull, ne } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP     = Date.now();
const ADMIN_EID = "U10";
const RETURNING = `TST_REACT_RET_${STAMP}`;   // has prior-year history
const NOHISTORY = `TST_REACT_NEW_${STAMP}`;   // never rostered
const HOLDSOPEN = `TST_REACT_OPN_${STAMP}`;   // already on this year
const ALL_EIDS  = [RETURNING, NOHISTORY, HOLDSOPEN];

type Jar = { cookieHeader: string };

async function request(method: string, path: string, body: unknown, jar: Jar) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: jar.cookieHeader },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: parsed as any };
}

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  return { cookieHeader: res.headers.get("set-cookie")!.split(";")[0]! };
}

async function openAssignmentsThisYear(empId: string) {
  return db.select({ id: assignments.id, schoolId: assignments.schoolId })
    .from(assignments)
    .where(and(
      eq(assignments.userId, empId),
      eq(assignments.schoolYearId, activeYearId),
      isNull(assignments.endDate),
    ));
}

let adminJar: Jar;
let schoolId: number;
let activeYearId: number;
let priorYearId: number | null = null;

describe("Reactivating restores this year's assignment", () => {
  before(async () => {
    const [school] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(1);
    assert.ok(school, "Need a school");
    schoolId = school.id;

    const [active] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(active, "Need an active school year");
    activeYearId = active.id;

    const [prior] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(ne(schoolYears.id, activeYearId)).orderBy(asc(schoolYears.id)).limit(1);
    priorYearId = prior?.id ?? null;

    await db.insert(people).values([
      { employeeId: RETURNING, firstName: "React", lastName: "Returning", email: `${RETURNING}@example.com`,
        role: "COACH", schoolId, isActive: false, includeInFeedbackTracker: false },
      { employeeId: NOHISTORY, firstName: "React", lastName: "NoHistory", email: `${NOHISTORY}@example.com`,
        role: "COACH", schoolId, isActive: false, includeInFeedbackTracker: false },
      { employeeId: HOLDSOPEN, firstName: "React", lastName: "HoldsOpen", email: `${HOLDSOPEN}@example.com`,
        role: "COACH", schoolId, isActive: false, includeInFeedbackTracker: false },
    ]).onConflictDoNothing();

    /* RETURNING looks exactly like somebody the rollover deactivated: a closed
       assignment in the prior year, nothing open in the active one. */
    if (priorYearId !== null) {
      await db.insert(assignments).values({
        userId: RETURNING, role: "COACH", schoolId, schoolYearId: priorYearId,
        startDate: "2025-08-01", endDate: "2026-07-31",
      });
    }

    await db.insert(assignments).values({
      userId: HOLDSOPEN, role: "COACH", schoolId, schoolYearId: activeYearId,
      startDate: "2026-08-01", endDate: null,
    });

    adminJar = await loginAs(ADMIN_EID);
  });

  after(async () => {
    await db.delete(assignments).where(inArray(assignments.userId, ALL_EIDS)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — reactivating restores an open assignment in the active year", async (t) => {
    if (priorYearId === null) { t.skip("needs a second school year"); return; }

    const before = await openAssignmentsThisYear(RETURNING);
    assert.equal(before.length, 0, "fixture should start with no open assignment this year");

    const res = await request("PATCH", `/people/${RETURNING}/toggle-active`, {}, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.isActive, true);

    const after = await openAssignmentsThisYear(RETURNING);
    assert.equal(after.length, 1, "reactivation must open an assignment for the active year");
    assert.equal(after[0]!.schoolId, schoolId, "it should use the person's own school");
  });

  test("2 — the restored person can actually use the API", async (t) => {
    if (priorYearId === null) { t.skip("needs a second school year"); return; }
    /* The real symptom was a 403 on every call, so assert the thing the user
       experienced rather than only the row in the table. */
    const jar = await loginAs(RETURNING);
    const res = await request("GET", "/people", undefined, jar);
    assert.notEqual(res.status, 403, `still blocked: ${JSON.stringify(res.body)}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("3 — somebody with no assignment history has none fabricated", async () => {
    const res = await request("PATCH", `/people/${NOHISTORY}/toggle-active`, {}, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = await db.select().from(assignments).where(eq(assignments.userId, NOHISTORY));
    assert.equal(rows.length, 0,
      "checkActiveThisYear already lets these through — inventing a roster row would scope them into a year they were never part of");
  });

  test("4 — an existing open assignment is left alone, not duplicated", async () => {
    const res = await request("PATCH", `/people/${HOLDSOPEN}/toggle-active`, {}, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = await openAssignmentsThisYear(HOLDSOPEN);
    assert.equal(rows.length, 1, "must not open a second assignment for the same year");
  });

  test("5 — deactivating does not write an assignment", async () => {
    /* HOLDSOPEN is active after test 4; toggle it back off. */
    const before = await db.select().from(assignments).where(eq(assignments.userId, HOLDSOPEN));
    const res = await request("PATCH", `/people/${HOLDSOPEN}/toggle-active`, {}, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.isActive, false);

    const after = await db.select().from(assignments).where(eq(assignments.userId, HOLDSOPEN));
    assert.equal(after.length, before.length,
      "closing an assignment is the rollover's job — it holds the history the departure calculation reads");
  });
});
