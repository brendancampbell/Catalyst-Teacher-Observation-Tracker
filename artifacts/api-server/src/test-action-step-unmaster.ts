/**
 * Integration tests: undoing "mastered" (backlog #15).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:action-step-unmaster
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * Mastery used to be one-way. Marking a step was a click, and editing a
 * mastered step is refused by business rule, so a misclick could not be undone
 * from the interface at all.
 *
 *   1. Undoing puts the step back to open and clears every mastery field
 *   2. It clears the link to the observation that mastered it, without
 *      touching the observation itself
 *   3. Undoing a step that is not mastered is refused
 *   4. It round-trips: master, undo, master again
 *   5. Someone at another school cannot undo it
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { observations, people, schools, rubricSets, actionSteps } from "@workspace/db/schema";
import { eq, inArray, asc, ne, and } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP       = Date.now();
const ADMIN_EID   = "U10";
const TEACHER_EID = `TST_UNM_TCH_${STAMP}`;
const OTHER_SL    = `TST_UNM_SL_${STAMP}`;
const ALL_EIDS    = [TEACHER_EID, OTHER_SL];
const FUTURE      = "2027-05-03";

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

const theStep = async () => {
  const [s] = await db.select().from(actionSteps).where(eq(actionSteps.teacherEmployeeId, TEACHER_EID)).limit(1);
  return s!;
};

let adminJar: Jar;
let otherJar: Jar;
let schoolId: number;
let otherSchoolId: number;
let rubricSetId: number;
let obsId: number;

describe("Undoing a mastered action step", () => {
  before(async () => {
    const [school] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(1);
    assert.ok(school, "Need a school");
    schoolId = school.id;

    const [other] = await db.select({ id: schools.id }).from(schools)
      .where(and(eq(schools.isHomeOffice, false), ne(schools.id, schoolId))).orderBy(asc(schools.id)).limit(1);
    assert.ok(other, "Need a second school");
    otherSchoolId = other.id;

    const [rubric] = await db.select({ id: rubricSets.id }).from(rubricSets).orderBy(asc(rubricSets.id)).limit(1);
    assert.ok(rubric, "Need a rubric set");
    rubricSetId = rubric.id;

    await db.insert(people).values([
      { employeeId: TEACHER_EID, firstName: "Unm", lastName: "Teacher", email: `${TEACHER_EID}@example.com`,
        role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true },
      { employeeId: OTHER_SL, firstName: "Unm", lastName: "OtherLeader", email: `${OTHER_SL}@example.com`,
        role: "SCHOOL_LEADER", schoolId: otherSchoolId, isActive: true, includeInFeedbackTracker: false },
    ]).onConflictDoNothing();

    adminJar = await loginAs(ADMIN_EID);

    /* An observation that both creates the step and masters it, so the
       mastered-during link is populated the way the app populates it. */
    const create = await request("POST", "/observations", {
      teacherId: TEACHER_EID, rubricSetId, date: "2026-07-18", scores: {},
      strengths: "s", growthAreas: "g", isWalkthrough: false, status: "published",
      newActionStep: { text: "Undo test step", dueDate: FUTURE },
    }, adminJar);
    assert.ok(create.status === 200 || create.status === 201, JSON.stringify(create.body));
    obsId = Number(create.body.id);

    const step = await theStep();
    const master = await request("POST", "/observations", {
      teacherId: TEACHER_EID, rubricSetId, date: "2026-07-19", scores: {},
      strengths: "s", growthAreas: "g", isWalkthrough: false, status: "published",
      masterActionStepId: step.id,
    }, adminJar);
    assert.ok(master.status === 200 || master.status === 201, JSON.stringify(master.body));
  });

  after(async () => {
    await db.delete(actionSteps).where(eq(actionSteps.teacherEmployeeId, TEACHER_EID)).catch(() => {});
    await db.delete(observations).where(eq(observations.observedEmployeeId, TEACHER_EID)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — the fixture really is mastered before we start", async () => {
    const step = await theStep();
    assert.equal(step.status, "mastered");
    assert.ok(step.masteredAt, "mastery should have a timestamp");
    assert.ok(step.masteredDuringObservationId, "and a link to the observation that did it");
  });

  test("2 — undoing puts it back to open and clears every mastery field", async () => {
    const before = await theStep();
    const res = await request("PATCH", `/action-steps/${before.id}/unmaster`, undefined, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const step = await theStep();
    assert.equal(step.status, "open");
    assert.equal(step.masteredAt, null);
    assert.equal(step.masteredByEmployeeId, null);
    assert.equal(step.masteredDuringObservationId, null,
      "otherwise the step still claims an observation mastered it");
    assert.equal(step.dueDate, FUTURE, "the original due date is kept — it goes back to how it was");
  });

  test("3 — the observation that mastered it is left alone", async () => {
    /* It happened. Undoing the mastery does not un-happen the visit. */
    const rows = await db.select().from(observations).where(eq(observations.id, obsId));
    assert.equal(rows.length, 1, "the observation must still exist");
  });

  test("4 — undoing a step that is not mastered is refused", async () => {
    const step = await theStep();
    const res = await request("PATCH", `/action-steps/${step.id}/unmaster`, undefined, adminJar);
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /not mastered/i);
  });

  test("5 — it round-trips: master, undo, master again", async () => {
    const step = await theStep();
    assert.equal((await request("PATCH", `/action-steps/${step.id}/master`, undefined, adminJar)).status, 200);
    assert.equal((await theStep()).status, "mastered");

    assert.equal((await request("PATCH", `/action-steps/${step.id}/unmaster`, undefined, adminJar)).status, 200);
    assert.equal((await theStep()).status, "open");

    assert.equal((await request("PATCH", `/action-steps/${step.id}/master`, undefined, adminJar)).status, 200);
    assert.equal((await theStep()).status, "mastered");
  });

  test("6 — a leader at another school cannot undo it", async () => {
    /* Same school scoping as marking it. Whoever can say "done" can say "not
       done after all" — and nobody else. */
    otherJar = await loginAs(OTHER_SL);
    const step = await theStep();
    const res = await request("PATCH", `/action-steps/${step.id}/unmaster`, undefined, otherJar);
    assert.ok(res.status === 403 || res.status === 404, `expected 403/404, got ${res.status}`);
    assert.equal((await theStep()).status, "mastered", "and it must still be mastered");
  });
});
