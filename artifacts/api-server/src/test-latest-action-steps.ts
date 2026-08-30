/**
 * Integration tests: GET /api/action-center/latest-action-steps
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:latest-action-steps
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * This endpoint backs the Latest Action Step tab, which replaced Overdue
 * Action Steps. That swap changed the unit of the list from one row per
 * overdue STEP to one row per TEACHER, and two things about it are easy to
 * break without anyone noticing:
 *
 *   - A teacher with NO action step must still appear. The old tab could not
 *     show that case at all, and it is the case the new tab exists for.
 *   - hasOverdueStep must consider EVERY step, not the displayed one. A
 *     teacher with an overdue step from earlier in the year who has since been
 *     given a fresh one would otherwise drop off the overdue filter entirely —
 *     strictly worse than the tab this replaced.
 *
 *   1. A teacher with no action step is returned, with latestStep null
 *   2. latestStep is the most recently created step, not the earliest
 *   3. hasOverdueStep is true when an EARLIER step is overdue and the newest is not
 *   4. hasOverdueStep is false when nothing is overdue
 *   5. A step assigned during a DRAFT observation is not shown
 *   6. Assigned date, due date and mastered state are all reported
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools, schoolYears, actionSteps, observations } from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP     = Date.now();
const ADMIN_EID = "U10";
const NO_STEPS  = `TST_LAS_NONE_${STAMP}`;
const TWO_STEPS = `TST_LAS_TWO_${STAMP}`;
const CURRENT   = `TST_LAS_OK_${STAMP}`;
const DRAFT_ONLY = `TST_LAS_DRAFT_${STAMP}`;
const ALL_EIDS  = [NO_STEPS, TWO_STEPS, CURRENT, DRAFT_ONLY];

/* Dates chosen relative to today so the test does not rot. */
const iso = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().split("T")[0]!;

type Jar = { cookieHeader: string };
type Row = {
  employeeId: string;
  hasOverdueStep: boolean;
  latestStep: null | {
    text: string; assignedDate: string; dueDate: string;
    mastered: boolean; isOverdue: boolean; daysOverdue: number | null;
  };
};

async function request(method: string, path: string, jar: Jar) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Cookie: jar.cookieHeader } });
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
let yearId: number;
let draftObsId: number;
let rows: Row[];

function rowFor(eid: string): Row {
  const r = rows.find((x) => x.employeeId === eid);
  assert.ok(r, `${eid} missing from the roster — every teacher must be returned`);
  return r!;
}

describe("GET /action-center/latest-action-steps", () => {
  before(async () => {
    const [school] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(1);
    assert.ok(school, "Need a school");
    schoolId = school.id;

    const [year] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");
    yearId = year.id;

    const base = {
      role: "NO_ACCESS" as const, schoolId, isActive: true,
      includeInFeedbackTracker: true, gradeLevel: ["6"], department: "Math" as const,
    };
    await db.insert(people).values([
      { employeeId: NO_STEPS,   firstName: "Nosteps", lastName: "Teacher", email: `${NO_STEPS}@example.com`.toLowerCase(),   ...base },
      { employeeId: TWO_STEPS,  firstName: "Twosteps", lastName: "Teacher", email: `${TWO_STEPS}@example.com`.toLowerCase(),  ...base },
      { employeeId: CURRENT,    firstName: "Current", lastName: "Teacher", email: `${CURRENT}@example.com`.toLowerCase(),    ...base },
      { employeeId: DRAFT_ONLY, firstName: "Draft",   lastName: "Teacher", email: `${DRAFT_ONLY}@example.com`.toLowerCase(), ...base },
    ]).onConflictDoNothing();

    /* TWO_STEPS: an old step that is open and long past due, then a newer one
       that is comfortably in the future. The displayed step is fine; the
       teacher is not. */
    await db.insert(actionSteps).values([
      { teacherEmployeeId: TWO_STEPS, text: "OLD overdue step", dueDate: iso(-30),
        status: "open", schoolYearId: yearId, snapshotSchoolId: schoolId,
        createdAt: new Date(Date.now() - 60 * 86_400_000) },
      { teacherEmployeeId: TWO_STEPS, text: "NEW step, not yet due", dueDate: iso(30),
        status: "open", schoolYearId: yearId, snapshotSchoolId: schoolId,
        createdAt: new Date(Date.now() - 1 * 86_400_000) },
      { teacherEmployeeId: CURRENT, text: "Mastered step", dueDate: iso(10),
        status: "mastered", masteredAt: new Date(), schoolYearId: yearId,
        snapshotSchoolId: schoolId, createdAt: new Date(Date.now() - 5 * 86_400_000) },
    ]);

    /* DRAFT_ONLY: a step hanging off an unpublished observation. Modern drafts
       hold their intended step on the observation instead, but drafts written
       before that change created real rows, and those must not surface. */
    const [obs] = await db.insert(observations).values({
      rubricSetId: (await db.query.rubricSets.findFirst({ where: (r, { eq: e }) => e(r.schoolYearId, yearId) }))!.id,
      date: iso(-3), status: "draft", schoolId, schoolYearId: yearId,
      target: "TEACHER", observedEmployeeId: DRAFT_ONLY, observerEmployeeId: ADMIN_EID,
    }).returning({ id: observations.id });
    draftObsId = obs!.id;

    await db.insert(actionSteps).values({
      teacherEmployeeId: DRAFT_ONLY, text: "Step from an unpublished draft",
      dueDate: iso(-5), status: "open", schoolYearId: yearId,
      snapshotSchoolId: schoolId, assignedDuringObservationId: draftObsId,
    });

    adminJar = await loginAs(ADMIN_EID);

    const res = await request("GET", `/action-center/latest-action-steps?schoolId=${schoolId}`, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    rows = res.body as Row[];
  });

  after(async () => {
    await db.delete(actionSteps).where(inArray(actionSteps.teacherEmployeeId, ALL_EIDS)).catch(() => {});
    if (draftObsId) await db.delete(observations).where(eq(observations.id, draftObsId)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — a teacher with no action step is still on the roster", () => {
    const r = rowFor(NO_STEPS);
    assert.equal(r.latestStep, null, "the blank row is the point of this tab");
    assert.equal(r.hasOverdueStep, false);
  });

  test("2 — latestStep is the most recent step, not the earliest", () => {
    const r = rowFor(TWO_STEPS);
    assert.ok(r.latestStep, "expected a step");
    assert.equal(r.latestStep!.text, "NEW step, not yet due");
  });

  test("3 — hasOverdueStep is true when an EARLIER step is overdue", () => {
    /* The regression this file exists for. The displayed step is not overdue,
       so a naive implementation reports the teacher as fine and they fall off
       the overdue filter that the retired tab used to catch them with. */
    const r = rowFor(TWO_STEPS);
    assert.equal(r.latestStep!.isOverdue, false, "the newest step is genuinely fine");
    assert.equal(r.hasOverdueStep, true,
      "an open, past-due step elsewhere in the year must still flag the teacher");
  });

  test("4 — hasOverdueStep is false when nothing is overdue", () => {
    assert.equal(rowFor(CURRENT).hasOverdueStep, false);
  });

  test("5 — a step assigned during a draft observation is not shown", () => {
    const r = rowFor(DRAFT_ONLY);
    assert.equal(r.latestStep, null, "an unpublished draft's step must not surface");
    assert.equal(r.hasOverdueStep, false,
      "and it must not flag the teacher as overdue either");
  });

  test("6 — assigned date, due date and mastered state are reported", () => {
    const r = rowFor(CURRENT);
    assert.ok(r.latestStep, "expected a step");
    assert.equal(r.latestStep!.mastered, true);
    assert.equal(r.latestStep!.dueDate, iso(10));
    assert.match(r.latestStep!.assignedDate, /^\d{4}-\d{2}-\d{2}$/,
      "assignedDate is a plain date, not a timestamp");
  });
});
