/**
 * Integration tests: a school's observation history, and moving one school-wide
 * observation to another school.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:school-profile
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * School-wide rubrics had almost none of what classroom rubrics had. The school
 * profile page needed a history endpoint, and correcting a mis-filed one needed
 * a way to move it — the counterpart of fixing the wrong teacher.
 *
 * Moving is the part worth pinning hardest. Every other correction on the PUT
 * route leaves an observation where it is; this one hands it to a different
 * school, and the school it leaves is the one whose leaders could reach it. So
 * it is network-only, enforced on the server rather than merely hidden in a
 * screen that only network roles can open.
 *
 *   1.  The history returns that school's school-wide observations
 *   2.  ...and only that school's
 *   3.  Drafts are left out of it
 *   4.  A classroom rubric is refused rather than answered with an empty list
 *   5.  A school leader cannot reach the history at all
 *   6.  A network admin moves an observation to another school
 *   7.  ...and it leaves the first school's history for the second's
 *   8.  A coach cannot move one
 *   9.  A school leader cannot move one, even their own school's
 *  10.  It cannot be moved to the Home Office
 *  11.  A teacher observation cannot be moved between schools
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  people, schools, schoolYears, observations,
  rubricSets, rubricCategories, rubricDomains,
} from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP   = Date.now();
const ADMIN   = `TST_SP_ADMIN_${STAMP}`;
const COACH   = `TST_SP_COACH_${STAMP}`;
const LEADER  = `TST_SP_SL_${STAMP}`;
const TEACHER = `TST_SP_TCH_${STAMP}`;
const ALL_EIDS = [ADMIN, COACH, LEADER, TEACHER];

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

let adminJar: Jar, coachJar: Jar, leaderJar: Jar;
let schoolA: number, schoolB: number, homeOfficeId: number, yearId: number;
let schoolRubricId: number, schoolRubricSlug: string;
let teacherRubricId: number, teacherRubricSlug: string;
let domainSlug: string;
const createdRubricIds: number[] = [];

/** A published school-wide observation at `schoolId`. */
async function fileSchoolObs(schoolId: number, date = "2026-09-14"): Promise<string> {
  const res = await request("POST", "/observations", {
    target: "SCHOOL", schoolId, rubricSetId: schoolRubricId, date,
    scores: { [domainSlug]: 1.0 },
    strengths: "s", growthAreas: "g", status: "published",
  }, adminJar);
  assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
  return String(res.body.id);
}

describe("School profile history, and moving a school-wide observation", () => {
  before(async () => {
    const real = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(2);
    assert.equal(real.length, 2, "Need two non-Home-Office schools");
    schoolA = real[0]!.id;
    schoolB = real[1]!.id;

    const [ho] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, true)).limit(1);
    assert.ok(ho, "Need a Home Office school");
    homeOfficeId = ho.id;

    const [year] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");
    yearId = year.id;

    /* One SCHOOL-target rubric and one TEACHER-target, so the endpoint's
       refusal of a classroom rubric can be tested against a real one. */
    schoolRubricSlug  = `tst-sp-school-${STAMP}`;
    teacherRubricSlug = `tst-sp-teacher-${STAMP}`;

    const [srs] = await db.insert(rubricSets)
      .values({ slug: schoolRubricSlug, name: "SP School RS", target: "SCHOOL", isActive: true, schoolYearId: yearId })
      .returning({ id: rubricSets.id });
    schoolRubricId = srs!.id;
    createdRubricIds.push(srs!.id);

    const [trs] = await db.insert(rubricSets)
      .values({ slug: teacherRubricSlug, name: "SP Teacher RS", target: "TEACHER", isActive: true, schoolYearId: yearId })
      .returning({ id: rubricSets.id });
    teacherRubricId = trs!.id;
    createdRubricIds.push(trs!.id);

    for (const rsId of [schoolRubricId, teacherRubricId]) {
      const [cat] = await db.insert(rubricCategories)
        .values({ rubricSetId: rsId, name: "SP Cat", displayOrder: 1 })
        .returning({ id: rubricCategories.id });
      const slug = `tst-sp-dom-${rsId}-${STAMP}`;
      await db.insert(rubricDomains).values({
        categoryId: cat!.id, rubricSetId: rsId, schoolYearId: yearId,
        slug, name: "SP Domain", displayOrder: 1,
      });
      if (rsId === schoolRubricId) domainSlug = slug;
    }

    await db.insert(people).values([
      { employeeId: ADMIN, firstName: "SP", lastName: "Admin", email: `${ADMIN}@example.com`.toLowerCase(),
        role: "NETWORK_ADMIN", schoolId: schoolA, isActive: true, includeInFeedbackTracker: false },
      { employeeId: COACH, firstName: "SP", lastName: "Coach", email: `${COACH}@example.com`.toLowerCase(),
        role: "COACH", schoolId: schoolA, isActive: true, includeInFeedbackTracker: false },
      { employeeId: LEADER, firstName: "SP", lastName: "Leader", email: `${LEADER}@example.com`.toLowerCase(),
        role: "SCHOOL_LEADER", schoolId: schoolA, isActive: true, includeInFeedbackTracker: false },
      { employeeId: TEACHER, firstName: "SP", lastName: "Teacher", email: `${TEACHER}@example.com`.toLowerCase(),
        role: "NO_ACCESS", schoolId: schoolA, isActive: true, includeInFeedbackTracker: true },
    ]).onConflictDoNothing();

    adminJar  = await loginAs(ADMIN);
    coachJar  = await loginAs(COACH);
    leaderJar = await loginAs(LEADER);
  });

  after(async () => {
    await db.delete(observations).where(inArray(observations.rubricSetId, createdRubricIds)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await db.delete(rubricSets).where(inArray(rubricSets.id, createdRubricIds)).catch(() => {});
    await pool.end().catch(() => {});
  });

  /* ── The history ────────────────────────────────────────────── */

  test("1 — returns that school's school-wide observations", async () => {
    const id = await fileSchoolObs(schoolA, "2026-09-01");
    const res = await request("GET", `/district/schools/${schoolA}/observations?rubricSet=${schoolRubricSlug}`, undefined, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.school.id, schoolA);
    assert.ok(res.body.observations.some((o: any) => o.id === id),
      "the observation just filed should be in the history");
  });

  test("2 — and only that school's", async () => {
    const atB = await fileSchoolObs(schoolB, "2026-09-02");
    const res = await request("GET", `/district/schools/${schoolA}/observations?rubricSet=${schoolRubricSlug}`, undefined, adminJar);
    assert.equal(res.status, 200);
    assert.ok(!res.body.observations.some((o: any) => o.id === atB),
      "another school's observation must not appear in this school's history");
  });

  test("3 — leaves drafts out", async () => {
    /* A draft is somebody's unfinished work, not part of the record. */
    const draft = await request("POST", "/observations", {
      target: "SCHOOL", schoolId: schoolA, rubricSetId: schoolRubricId, date: "2026-09-03",
      scores: { [domainSlug]: 1.0 }, status: "draft",
    }, adminJar);
    assert.ok(draft.status === 200 || draft.status === 201, JSON.stringify(draft.body));

    const res = await request("GET", `/district/schools/${schoolA}/observations?rubricSet=${schoolRubricSlug}`, undefined, adminJar);
    assert.ok(!res.body.observations.some((o: any) => o.id === String(draft.body.id)),
      "a draft must not appear in the history");
  });

  test("4 — refuses a classroom rubric rather than answering empty", async () => {
    /* An empty list would read as a school nobody has observed, which is a
       different and wrong answer. */
    const res = await request("GET", `/district/schools/${schoolA}/observations?rubricSet=${teacherRubricSlug}`, undefined, adminJar);
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  test("5 — a school leader cannot reach the history at all", async () => {
    const res = await request("GET", `/district/schools/${schoolA}/observations?rubricSet=${schoolRubricSlug}`, undefined, leaderJar);
    assert.ok(res.status === 403 || res.status === 401, `expected a refusal, got ${res.status}`);
  });

  /* ── Moving one ─────────────────────────────────────────────── */

  test("6 — a network admin moves an observation to another school", async () => {
    const id = await fileSchoolObs(schoolA, "2026-09-05");
    const res = await request("PUT", `/observations/${id}`, { schoolId: schoolB }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [row] = await db.select({ schoolId: observations.schoolId })
      .from(observations).where(eq(observations.id, Number(id))).limit(1);
    assert.equal(row!.schoolId, schoolB);
  });

  test("7 — and it moves between the two histories", async () => {
    const id = await fileSchoolObs(schoolA, "2026-09-06");
    await request("PUT", `/observations/${id}`, { schoolId: schoolB }, adminJar);

    const a = await request("GET", `/district/schools/${schoolA}/observations?rubricSet=${schoolRubricSlug}`, undefined, adminJar);
    const b = await request("GET", `/district/schools/${schoolB}/observations?rubricSet=${schoolRubricSlug}`, undefined, adminJar);
    assert.ok(!a.body.observations.some((o: any) => o.id === id), "it should have left the first school");
    assert.ok(b.body.observations.some((o: any) => o.id === id),  "it should have arrived at the second");
  });

  test("8 — a coach cannot move one", async () => {
    const id = await fileSchoolObs(schoolA, "2026-09-07");
    const res = await request("PUT", `/observations/${id}`, { schoolId: schoolB }, coachJar);
    assert.equal(res.status, 403, JSON.stringify(res.body));

    const [row] = await db.select({ schoolId: observations.schoolId })
      .from(observations).where(eq(observations.id, Number(id))).limit(1);
    assert.equal(row!.schoolId, schoolA, "the refusal must leave it where it was");
  });

  test("9 — nor a school leader, even at the school it belongs to", async () => {
    /* The stricter rule this exists for: somebody who can see one school
       should not be able to push a record out of it. */
    const id = await fileSchoolObs(schoolA, "2026-09-08");
    const res = await request("PUT", `/observations/${id}`, { schoolId: schoolB }, leaderJar);
    assert.equal(res.status, 403, JSON.stringify(res.body));

    const [row] = await db.select({ schoolId: observations.schoolId })
      .from(observations).where(eq(observations.id, Number(id))).limit(1);
    assert.equal(row!.schoolId, schoolA, "the refusal must leave it where it was");
  });

  test("10 — it cannot be moved to the Home Office", async () => {
    const id = await fileSchoolObs(schoolA, "2026-09-09");
    const res = await request("PUT", `/observations/${id}`, { schoolId: homeOfficeId }, adminJar);
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  test("11 — a teacher observation cannot be moved between schools", async () => {
    /* Its school is decided by the teacher it is about; moving it would leave
       the two disagreeing. */
    const created = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId: teacherRubricId, date: "2026-09-10",
      scores: {}, status: "published",
    }, adminJar);
    assert.ok(created.status === 200 || created.status === 201, JSON.stringify(created.body));

    const res = await request("PUT", `/observations/${created.body.id}`, { schoolId: schoolB }, adminJar);
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });
});
