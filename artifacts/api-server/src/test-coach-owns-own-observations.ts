/**
 * Integration tests: a coach may correct and remove their OWN observations.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:coach-owns-own
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * A coach could file an observation and then not touch it. Putting it on the
 * wrong teacher, or mistyping the date, meant finding a school leader to fix
 * something the coach had written themselves. Their own work is now theirs to
 * correct or remove, with no time limit — an error found late is still an
 * error — while everybody else's stays exactly as protected as before.
 *
 *   1. A coach edits their own filed observation
 *   2. The edit is stamped, so it is recorded rather than silent
 *   3. A coach cannot edit an observation somebody else wrote
 *   4. A coach reassigns their own observation to another teacher
 *   5. ...but not across a school boundary
 *   6. A coach deletes their own observation
 *   7. A coach cannot delete somebody else's
 *   8. A school leader can still edit an observation a coach wrote
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

const STAMP     = Date.now();
const COACH_A   = `TST_OWN_COACH_A_${STAMP}`;
const COACH_B   = `TST_OWN_COACH_B_${STAMP}`;
const LEADER    = `TST_OWN_SL_${STAMP}`;
const TEACHER_1 = `TST_OWN_TCH1_${STAMP}`;
const TEACHER_2 = `TST_OWN_TCH2_${STAMP}`;
const TEACHER_X = `TST_OWN_TCHX_${STAMP}`;   /* another school */
const ALL_EIDS  = [COACH_A, COACH_B, LEADER, TEACHER_1, TEACHER_2, TEACHER_X];

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

let coachAJar: Jar, coachBJar: Jar, leaderJar: Jar;
let schoolId: number, otherSchoolId: number, yearId: number;
let rubricSetId: number, domainSlug: string;
let createdRubricSetId: number | null = null;

/** A fresh published observation by COACH_A on TEACHER_1. */
async function fileOne(date = "2026-09-14"): Promise<string> {
  const res = await request("POST", "/observations", {
    teacherId: TEACHER_1, rubricSetId, date,
    scores: { [domainSlug]: 1.0 },
    strengths: "original glow", growthAreas: "original grow",
    status: "published",
  }, coachAJar);
  assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
  return String(res.body.id);
}

describe("A coach owns their own observations", () => {
  before(async () => {
    const twoSchools = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(2);
    assert.equal(twoSchools.length, 2, "Need two non-Home-Office schools");
    schoolId      = twoSchools[0]!.id;
    otherSchoolId = twoSchools[1]!.id;

    const [year] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");
    yearId = year.id;

    const [rs] = await db.insert(rubricSets)
      .values({ slug: `tst-own-rs-${STAMP}`, name: "Own Observations RS",
                target: "TEACHER", isActive: true, schoolYearId: yearId })
      .returning({ id: rubricSets.id });
    assert.ok(rs);
    rubricSetId = rs.id;
    createdRubricSetId = rs.id;

    const [cat] = await db.insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "Own Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat);

    const [dom] = await db.insert(rubricDomains)
      .values({ categoryId: cat.id, rubricSetId: rs.id, schoolYearId: yearId,
                slug: `tst-own-dom-${STAMP}`, name: "Own Domain", displayOrder: 1 })
      .returning({ slug: rubricDomains.slug });
    assert.ok(dom);
    domainSlug = dom.slug;

    await db.insert(people).values([
      { employeeId: COACH_A, firstName: "Own", lastName: "CoachA", email: `${COACH_A}@example.com`.toLowerCase(),
        role: "COACH", schoolId, isActive: true, includeInFeedbackTracker: false },
      { employeeId: COACH_B, firstName: "Own", lastName: "CoachB", email: `${COACH_B}@example.com`.toLowerCase(),
        role: "COACH", schoolId, isActive: true, includeInFeedbackTracker: false },
      { employeeId: LEADER, firstName: "Own", lastName: "Leader", email: `${LEADER}@example.com`.toLowerCase(),
        role: "SCHOOL_LEADER", schoolId, isActive: true, includeInFeedbackTracker: false },
      { employeeId: TEACHER_1, firstName: "Own", lastName: "TeachOne", email: `${TEACHER_1}@example.com`.toLowerCase(),
        role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true },
      { employeeId: TEACHER_2, firstName: "Own", lastName: "TeachTwo", email: `${TEACHER_2}@example.com`.toLowerCase(),
        role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true },
      { employeeId: TEACHER_X, firstName: "Own", lastName: "TeachOther", email: `${TEACHER_X}@example.com`.toLowerCase(),
        role: "NO_ACCESS", schoolId: otherSchoolId, isActive: true, includeInFeedbackTracker: true },
    ]).onConflictDoNothing();

    coachAJar = await loginAs(COACH_A);
    coachBJar = await loginAs(COACH_B);
    leaderJar = await loginAs(LEADER);
  });

  after(async () => {
    await db.delete(observations)
      .where(inArray(observations.observedEmployeeId, [TEACHER_1, TEACHER_2, TEACHER_X])).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    if (createdRubricSetId !== null) {
      await db.delete(rubricSets).where(eq(rubricSets.id, createdRubricSetId)).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  test("1 — a coach edits their own filed observation", async () => {
    const id = await fileOne();
    const res = await request("PUT", `/observations/${id}`,
      { strengths: "corrected glow", date: "2026-09-15" }, coachAJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.strengths, "corrected glow");
    assert.equal(res.body.date, "2026-09-15");
  });

  test("2 — the edit is stamped rather than silent", async () => {
    /* A draft autosave is the only write that skips the stamp. Correcting a
       FILED observation is recorded, whoever does it — that is what makes an
       unlimited edit window defensible. */
    const id = await fileOne("2026-09-16");
    await request("PUT", `/observations/${id}`, { strengths: "edited" }, coachAJar);

    const [row] = await db
      .select({ editedBy: observations.editedByEmployeeId, updatedAt: observations.updatedAt })
      .from(observations).where(eq(observations.id, Number(id))).limit(1);
    assert.equal(row!.editedBy, COACH_A, "the edit must record who made it");
    assert.ok(row!.updatedAt, "the edit must record when");
  });

  test("3 — a coach cannot edit an observation somebody else wrote", async () => {
    const id = await fileOne("2026-09-17");
    const res = await request("PUT", `/observations/${id}`, { strengths: "not yours" }, coachBJar);
    assert.equal(res.status, 403, JSON.stringify(res.body));

    const [row] = await db.select({ strengths: observations.strengths })
      .from(observations).where(eq(observations.id, Number(id))).limit(1);
    assert.equal(row!.strengths, "original glow", "the refusal must leave the observation alone");
  });

  test("4 — a coach reassigns their own observation to another teacher", async () => {
    /* The mistake this exists for: picking the wrong name from the list. */
    const id = await fileOne("2026-09-18");
    const res = await request("PUT", `/observations/${id}`,
      { observedEmployeeId: TEACHER_2 }, coachAJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [row] = await db.select({ observed: observations.observedEmployeeId })
      .from(observations).where(eq(observations.id, Number(id))).limit(1);
    assert.equal(row!.observed, TEACHER_2);
  });

  test("5 — ...but not to a teacher at another school", async () => {
    const id = await fileOne("2026-09-19");
    const res = await request("PUT", `/observations/${id}`,
      { observedEmployeeId: TEACHER_X }, coachAJar);
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  test("6 — a coach deletes their own observation", async () => {
    const id = await fileOne("2026-09-20");
    const res = await request("DELETE", `/observations/${id}`, undefined, coachAJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = await db.select({ id: observations.id })
      .from(observations).where(eq(observations.id, Number(id)));
    assert.equal(rows.length, 0, "the observation should be gone");
  });

  test("7 — a coach cannot delete somebody else's", async () => {
    const id = await fileOne("2026-09-21");
    const res = await request("DELETE", `/observations/${id}`, undefined, coachBJar);
    assert.equal(res.status, 403, JSON.stringify(res.body));

    const rows = await db.select({ id: observations.id })
      .from(observations).where(eq(observations.id, Number(id)));
    assert.equal(rows.length, 1, "the refusal must leave the observation in place");
  });

  test("8 — a school leader can still edit an observation a coach wrote", async () => {
    /* The half that did not change. */
    const id = await fileOne("2026-09-22");
    const res = await request("PUT", `/observations/${id}`,
      { strengths: "leader corrected" }, leaderJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.strengths, "leader corrected");
  });
});
