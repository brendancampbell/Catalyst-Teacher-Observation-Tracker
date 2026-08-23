/**
 * Integration tests for GET /api/usage (backlog #20, and #14 folded into it).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:usage-report
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * The counts are straightforward; the scoping is not, and it is the part that
 * would leak. A coach can open this, and sees their own school only.
 *
 *   1. A network admin sees people from more than one school
 *   2. A school leader sees only their own school
 *   3. Counts attribute to the right person, and drafts do not count
 *   4. Extensions count towards action steps
 *   5. Someone who has never used Catalyst appears, with nulls not omission
 *   6. A school user cannot widen their scope by asking for another school
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  observations, people, schools, rubricSets, actionSteps, actionStepExtensions,
  userActivityDays, schoolYears,
} from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP    = Date.now();
const ADMIN    = "U10";
const SL_EID   = `TST_USE_SL_${STAMP}`;     /* school leader, school A */
const COACH    = `TST_USE_CO_${STAMP}`;     /* coach, school A         */
const OTHER    = `TST_USE_OT_${STAMP}`;     /* coach, school B         */
const NEVER    = `TST_USE_NV_${STAMP}`;     /* never used it           */
const TEACHER  = `TST_USE_TCH_${STAMP}`;
const ALL_EIDS = [SL_EID, COACH, OTHER, NEVER, TEACHER];

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
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  return { cookieHeader: res.headers.get("set-cookie")!.split(";")[0]! };
}

const rowFor = (body: any, eid: string) => body.rows.find((r: any) => r.employeeId === eid);

let adminJar: Jar, slJar: Jar;
let schoolA: number, schoolB: number, rubricSetId: number;
const obsIds: number[] = [];

describe("GET /usage", () => {
  before(async () => {
    const found = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(2);
    assert.equal(found.length, 2, "Need two non-home-office schools");
    schoolA = found[0]!.id; schoolB = found[1]!.id;

    const [rubric] = await db.select({ id: rubricSets.id }).from(rubricSets).orderBy(asc(rubricSets.id)).limit(1);
    assert.ok(rubric, "Need a rubric set");
    rubricSetId = rubric.id;

    const [year] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");

    await db.insert(people).values([
      { employeeId: SL_EID,  firstName: "Use", lastName: "Leader",  email: `${SL_EID}@example.com`,  role: "SCHOOL_LEADER", schoolId: schoolA, isActive: true, includeInFeedbackTracker: false },
      { employeeId: COACH,   firstName: "Use", lastName: "Coach",   email: `${COACH}@example.com`,   role: "COACH",         schoolId: schoolA, isActive: true, includeInFeedbackTracker: false },
      { employeeId: OTHER,   firstName: "Use", lastName: "Other",   email: `${OTHER}@example.com`,   role: "COACH",         schoolId: schoolB, isActive: true, includeInFeedbackTracker: false },
      { employeeId: NEVER,   firstName: "Use", lastName: "Never",   email: `${NEVER}@example.com`,   role: "COACH",         schoolId: schoolA, isActive: true, includeInFeedbackTracker: false },
      { employeeId: TEACHER, firstName: "Use", lastName: "Teacher", email: `${TEACHER}@example.com`, role: "NO_ACCESS",     schoolId: schoolA, isActive: true, includeInFeedbackTracker: true },
    ]).onConflictDoNothing();

    adminJar = await loginAs(ADMIN);
    slJar    = await loginAs(SL_EID);
  });

  after(async () => {
    const steps = await db.select({ id: actionSteps.id }).from(actionSteps)
      .where(inArray(actionSteps.teacherEmployeeId, ALL_EIDS)).catch(() => []);
    for (const s of steps) {
      await db.delete(actionStepExtensions).where(eq(actionStepExtensions.actionStepId, s.id)).catch(() => {});
    }
    await db.delete(actionSteps).where(inArray(actionSteps.teacherEmployeeId, ALL_EIDS)).catch(() => {});
    await db.delete(userActivityDays).where(inArray(userActivityDays.employeeId, ALL_EIDS)).catch(() => {});
    if (obsIds.length) await db.delete(observations).where(inArray(observations.id, obsIds)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — a network admin sees more than one school", async () => {
    const res = await request("GET", "/usage", undefined, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(rowFor(res.body, COACH), "should include the school A coach");
    assert.ok(rowFor(res.body, OTHER), "should include the school B coach");
  });

  test("2 — a teacher with no access does not appear", async () => {
    /* The report is about people who can observe. A NO_ACCESS row would be a
       list of zeroes with nothing to act on. */
    const res = await request("GET", "/usage", undefined, adminJar);
    assert.equal(rowFor(res.body, TEACHER), undefined);
  });

  test("3 — someone who has never used it appears, with nulls", async () => {
    /* The people who have not touched Catalyst are the entire point, so they
       must not fall out of the report for lack of a row to join to. */
    const res = await request("GET", "/usage", undefined, adminJar);
    const row = rowFor(res.body, NEVER);
    assert.ok(row, "never-used person must still be listed");
    assert.equal(row.lastUsed, null);
    assert.equal(row.daysUsed, 0);
    assert.equal(row.observations, 0);
    assert.equal(row.actionSteps, 0);
  });

  test("4 — published observations count, drafts do not", async () => {
    const published = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-08-20", scores: {},
      strengths: "s", growthAreas: "g", isWalkthrough: false, status: "published",
    }, slJar);
    assert.ok(published.status === 200 || published.status === 201, JSON.stringify(published.body));
    obsIds.push(Number(published.body.id));

    const draft = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-08-20", scores: {},
      strengths: "s", growthAreas: "g", isWalkthrough: false, status: "draft",
    }, slJar);
    obsIds.push(Number(draft.body.id));

    const res = await request("GET", "/usage", undefined, adminJar);
    assert.equal(rowFor(res.body, SL_EID).observations, 1,
      "the draft must not be counted alongside the published one");
  });

  test("5 — an extension counts towards action steps", async () => {
    const before = rowFor((await request("GET", "/usage", undefined, adminJar)).body, SL_EID).actionSteps;

    const withStep = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-08-21", scores: {},
      strengths: "s", growthAreas: "g", isWalkthrough: false, status: "published",
      newActionStep: { text: "Usage test step", dueDate: "2027-05-03" },
    }, slJar);
    obsIds.push(Number(withStep.body.id));

    const [step] = await db.select().from(actionSteps)
      .where(eq(actionSteps.teacherEmployeeId, TEACHER)).limit(1);
    assert.ok(step, "the observation should have created a step");

    const extended = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-08-22", scores: {},
      strengths: "s", growthAreas: "g", isWalkthrough: false, status: "published",
      extendActionStep: { actionStepId: step.id, newDueDate: "2027-06-14" },
    }, slJar);
    obsIds.push(Number(extended.body.id));

    const after = rowFor((await request("GET", "/usage", undefined, adminJar)).body, SL_EID).actionSteps;
    assert.equal(after, before + 2,
      "one new step plus one extension — revisiting a step is still coaching work");
  });

  test("6 — a school leader sees only their own school", async () => {
    const res = await request("GET", "/usage", undefined, slJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(rowFor(res.body, COACH), "own-school coach should be listed");
    assert.equal(rowFor(res.body, OTHER), undefined, "another school's coach must not be");
  });

  test("7 — a school user cannot widen their scope by asking", async () => {
    /* Same fail-closed shape as the people and action-step routes: the query
       parameter is ignored for school users rather than obeyed. */
    const res = await request("GET", `/usage?schoolId=${schoolB}`, undefined, slJar);
    assert.equal(res.status, 200);
    assert.equal(rowFor(res.body, OTHER), undefined,
      "asking for another school must not return it");
    assert.ok(rowFor(res.body, COACH), "and must not empty their own list either");
  });
});
