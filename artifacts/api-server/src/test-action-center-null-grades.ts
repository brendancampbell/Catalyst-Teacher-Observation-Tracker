/**
 * Integration tests: a teacher with no grade levels does not break the page.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:action-center-null-grades
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * people.grade_level is a nullable text[] and every teacher in production was
 * uploaded without one. The published type says string[], so the client wrote
 * `item.gradeLevel.length` — correct against the type, fatal against the data.
 * The first teacher with no grades to reach the rescore queue white-screened
 * the whole Action Center.
 *
 * Grade level is decorative there: a grey suffix beside the department. A
 * missing one should show nothing, not take the page down. The endpoints now
 * coalesce, so the type is true rather than aspirational.
 *
 *   1. The rescore queue returns [] rather than null for a teacher with none
 *   2. So does the overdue-observations list
 *   3. A teacher WITH grades still reports them
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools, schoolYears } from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP     = Date.now();
const ADMIN_EID = "U10";
const NO_GRADES = `TST_NG_NONE_${STAMP}`;
const HAS_GRADE = `TST_NG_SOME_${STAMP}`;
const ALL_EIDS  = [NO_GRADES, HAS_GRADE];

type Jar = { cookieHeader: string };

async function request(method: string, path: string, jar: Jar) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { Cookie: jar.cookieHeader },
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

let adminJar: Jar;
let schoolId: number;

describe("A teacher with no grade levels does not break the Action Center", () => {
  before(async () => {
    const [school] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(1);
    assert.ok(school, "Need a school");
    schoolId = school.id;

    const [year] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");

    const due = "2026-12-01";
    await db.insert(people).values([
      /* Exactly what production looks like: a teacher flagged for rescore with
         no grade levels at all. */
      { employeeId: NO_GRADES, firstName: "Nograde", lastName: "Teacher",
        email: `${NO_GRADES}@example.com`.toLowerCase(),
        role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true,
        gradeLevel: null, needsRescore: true, rescoreDueDate: due, rescoreSchoolYearId: year.id },
      { employeeId: HAS_GRADE, firstName: "Withgrade", lastName: "Teacher",
        email: `${HAS_GRADE}@example.com`.toLowerCase(),
        role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true,
        gradeLevel: ["9", "10"], needsRescore: true, rescoreDueDate: due, rescoreSchoolYearId: year.id },
    ]).onConflictDoNothing();

    adminJar = await loginAs(ADMIN_EID);
  });

  after(async () => {
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — the rescore queue returns [] rather than null", async () => {
    const res = await request("GET", `/action-center/rescore-queue?schoolId=${schoolId}`, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const row = (res.body as Array<{ employeeId: string; gradeLevel: unknown }>)
      .find((r) => r.employeeId === NO_GRADES);
    assert.ok(row, "the teacher should be in the queue");
    assert.notEqual(row!.gradeLevel, null,
      "null here crashed the page on .length — the type promises an array");
    assert.deepEqual(row!.gradeLevel, []);
  });

  test("2 — so does the overdue-observations list", async () => {
    const res = await request("GET", `/action-center/overdue-observations?schoolId=${schoolId}`, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const row = (res.body as Array<{ employeeId: string; gradeLevel: unknown }>)
      .find((r) => r.employeeId === NO_GRADES);
    if (row) {
      assert.notEqual(row.gradeLevel, null);
      assert.deepEqual(row.gradeLevel, []);
    }
  });

  test("3 — a teacher with grades still reports them", async () => {
    /* The coalesce must not flatten real data. */
    const res = await request("GET", `/action-center/rescore-queue?schoolId=${schoolId}`, adminJar);
    const row = (res.body as Array<{ employeeId: string; gradeLevel: string[] }>)
      .find((r) => r.employeeId === HAS_GRADE);
    assert.ok(row, "the teacher should be in the queue");
    assert.deepEqual(row!.gradeLevel, ["9", "10"]);
  });
});
