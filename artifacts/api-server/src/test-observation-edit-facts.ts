/**
 * Integration tests: correcting the facts of an observation.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:observation-edit-facts
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * Editing accepted only the wording, the scores and the status. Everything
 * factual — when it happened, whether it was a walkthrough, whose it was — was
 * fixed at creation, so a mistyped date or the wrong name from a list could
 * not be put right.
 *
 * The rescore queue is the reason this is more than a form change. It cannot
 * be decided from the observation just written: toggling walkthrough OFF has
 * to remove a flag, changing a date has to move a deadline, and reassigning
 * has to settle two teachers at once.
 *
 *   1. Date and time can be corrected
 *   2. Toggling walkthrough ON puts a below-threshold teacher in the queue
 *   3. Toggling it OFF takes them out again
 *   4. Changing the date moves the rescore deadline with it
 *   5. An observation can be reassigned within the same school
 *   6. Reassigning clears the old teacher's queue entry and flags the new one
 *   7. Reassigning across schools is refused
 *   8. Editing only the wording leaves the queue alone
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  people, schools, schoolYears, observations,
  rubricSets, rubricCategories, rubricDomains,
} from "@workspace/db/schema";
import { eq, inArray, asc, and, ne } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP     = Date.now();
const ADMIN_EID = "U10";
const TEACHER_A = `TST_OEF_A_${STAMP}`;
const TEACHER_B = `TST_OEF_B_${STAMP}`;
const FOREIGN   = `TST_OEF_F_${STAMP}`;
const ALL_EIDS  = [TEACHER_A, TEACHER_B, FOREIGN];
const BELOW = 0.5;
const ABOVE = 1.0;

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

const rescoreOf = async (employeeId: string) => {
  const [p] = await db.select({
    needsRescore: people.needsRescore,
    dueDate:      people.rescoreDueDate,
    fromDate:     people.rescoreFromDate,
  }).from(people).where(eq(people.employeeId, employeeId)).limit(1);
  return p!;
};

async function makeObservation(teacher: string, date: string, score: number, walkthrough: boolean) {
  const res = await request("POST", "/observations", {
    teacherId: teacher, rubricSetId, date, scores: { [domainSlug]: score },
    strengths: "s", growthAreas: "g", isWalkthrough: walkthrough, status: "published",
  }, adminJar);
  assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
  return Number(res.body.id);
}

let adminJar: Jar;
let schoolId: number;
let otherSchoolId: number;
let yearId: number;
let rubricSetId: number;
let domainSlug: string;

describe("Correcting the facts of an observation", () => {
  before(async () => {
    const [school] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(1);
    assert.ok(school, "Need a school");
    schoolId = school.id;

    const [other] = await db.select({ id: schools.id }).from(schools)
      .where(and(eq(schools.isHomeOffice, false), ne(schools.id, schoolId)))
      .orderBy(asc(schools.id)).limit(1);
    assert.ok(other, "Need a second school");
    otherSchoolId = other.id;

    const [year] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");
    yearId = year.id;

    const [rs] = await db.insert(rubricSets)
      .values({ slug: `tst-oef-rs-${STAMP}`, name: "Edit Facts RS",
                target: "TEACHER", isActive: true, schoolYearId: yearId })
      .returning({ id: rubricSets.id });
    assert.ok(rs);
    rubricSetId = rs.id;

    const [cat] = await db.insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "OEF Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat);

    const [dom] = await db.insert(rubricDomains)
      .values({ categoryId: cat.id, rubricSetId: rs.id, schoolYearId: yearId,
                slug: `tst-oef-dom-${STAMP}`, name: "OEF Domain", displayOrder: 1 })
      .returning({ slug: rubricDomains.slug });
    assert.ok(dom);
    domainSlug = dom.slug;

    await db.insert(people).values([
      { employeeId: TEACHER_A, firstName: "Oef", lastName: "TeacherA",
        email: `${TEACHER_A}@example.com`.toLowerCase(),
        role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true },
      { employeeId: TEACHER_B, firstName: "Oef", lastName: "TeacherB",
        email: `${TEACHER_B}@example.com`.toLowerCase(),
        role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true },
      { employeeId: FOREIGN, firstName: "Oef", lastName: "Foreign",
        email: `${FOREIGN}@example.com`.toLowerCase(),
        role: "NO_ACCESS", schoolId: otherSchoolId, isActive: true, includeInFeedbackTracker: true },
    ]).onConflictDoNothing();

    adminJar = await loginAs(ADMIN_EID);
  });

  after(async () => {
    await db.delete(observations).where(inArray(observations.observedEmployeeId, ALL_EIDS)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await db.delete(rubricSets).where(eq(rubricSets.id, rubricSetId)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — date and time can be corrected", async () => {
    const obsId = await makeObservation(TEACHER_A, "2026-11-01", ABOVE, false);

    const res = await request("PUT", `/observations/${obsId}`,
      { date: "2026-11-05", time: "14:30" }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [row] = await db.select({ date: observations.date, time: observations.time })
      .from(observations).where(eq(observations.id, obsId)).limit(1);
    assert.equal(String(row!.date), "2026-11-05");
    assert.equal(row!.time, "14:30");
  });

  test("2 — toggling walkthrough ON queues a below-threshold teacher", async () => {
    const obsId = await makeObservation(TEACHER_A, "2026-11-10", BELOW, false);
    assert.equal((await rescoreOf(TEACHER_A)).needsRescore, false,
      "an ordinary observation should not have queued anybody");

    const res = await request("PUT", `/observations/${obsId}`, { isWalkthrough: true }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const after = await rescoreOf(TEACHER_A);
    assert.equal(after.needsRescore, true, "marking it a walkthrough should queue them");
    assert.equal(String(after.fromDate), "2026-11-10");
  });

  test("3 — toggling it OFF takes them out again", async () => {
    const [obs] = await db.select({ id: observations.id }).from(observations)
      .where(and(eq(observations.observedEmployeeId, TEACHER_A), eq(observations.date, "2026-11-10")))
      .limit(1);
    assert.ok(obs);

    const res = await request("PUT", `/observations/${obs.id}`, { isWalkthrough: false }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    assert.equal((await rescoreOf(TEACHER_A)).needsRescore, false,
      "the flag it caused has to go with it, or the queue says something no observation supports");
  });

  test("4 — changing the date moves the rescore deadline with it", async () => {
    const obsId = await makeObservation(TEACHER_A, "2026-11-12", BELOW, true);
    const before = await rescoreOf(TEACHER_A);
    assert.equal(before.needsRescore, true);
    assert.equal(String(before.fromDate), "2026-11-12");

    const res = await request("PUT", `/observations/${obsId}`, { date: "2026-11-20" }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const after = await rescoreOf(TEACHER_A);
    assert.equal(String(after.fromDate), "2026-11-20", "the deadline is measured from the observation");
    assert.notEqual(String(after.dueDate), String(before.dueDate), "so it should have moved");
  });

  test("5 — an observation can be reassigned within the same school", async () => {
    const obsId = await makeObservation(TEACHER_A, "2026-11-25", ABOVE, false);

    const res = await request("PUT", `/observations/${obsId}`,
      { observedEmployeeId: TEACHER_B }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [row] = await db.select({ observed: observations.observedEmployeeId })
      .from(observations).where(eq(observations.id, obsId)).limit(1);
    assert.equal(row!.observed, TEACHER_B);
  });

  test("6 — reassigning settles both teachers' queue entries", async () => {
    /* The case a per-observation rule cannot handle: one person leaves the
       queue and another joins, from a single edit.

       Cleared first, because earlier tests leave Teacher A with a
       below-threshold walkthrough of their own. The recompute re-derives from
       everything on record — correctly — so without this the assertion below
       would be measuring that leftover rather than the reassignment. */
    await db.delete(observations)
      .where(inArray(observations.observedEmployeeId, [TEACHER_A, TEACHER_B]));
    await db.update(people)
      .set({ needsRescore: false, rescoreDueDate: null, rescoreFromDate: null, rescoreSchoolYearId: null })
      .where(inArray(people.employeeId, [TEACHER_A, TEACHER_B]));

    const obsId = await makeObservation(TEACHER_A, "2026-12-01", BELOW, true);
    assert.equal((await rescoreOf(TEACHER_A)).needsRescore, true);
    assert.equal((await rescoreOf(TEACHER_B)).needsRescore, false);

    const res = await request("PUT", `/observations/${obsId}`,
      { observedEmployeeId: TEACHER_B }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    assert.equal((await rescoreOf(TEACHER_B)).needsRescore, true,
      "the teacher it now belongs to should be queued");
    assert.equal((await rescoreOf(TEACHER_A)).needsRescore, false,
      "and the one it was taken from should not be, since nothing supports it any more");
  });

  test("7 — reassigning across schools is refused", async () => {
    const obsId = await makeObservation(TEACHER_B, "2026-12-05", ABOVE, false);

    const res = await request("PUT", `/observations/${obsId}`,
      { observedEmployeeId: FOREIGN }, adminJar);
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(String(res.body.error), /same school/i);

    const [row] = await db.select({ observed: observations.observedEmployeeId })
      .from(observations).where(eq(observations.id, obsId)).limit(1);
    assert.equal(row!.observed, TEACHER_B, "and nothing should have moved");
  });

  test("8 — editing only the wording leaves the queue alone", async () => {
    const obsId = await makeObservation(TEACHER_B, "2026-12-10", BELOW, true);
    const before = await rescoreOf(TEACHER_B);
    assert.equal(before.needsRescore, true);

    const res = await request("PUT", `/observations/${obsId}`,
      { strengths: "Rewritten glows" }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const after = await rescoreOf(TEACHER_B);
    assert.equal(String(after.dueDate), String(before.dueDate),
      "a wording change is not a reason to recompute anybody's deadline");
  });
});
