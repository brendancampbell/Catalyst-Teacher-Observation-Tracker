/**
 * Integration tests: what deleting an observation does to its action steps.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:observation-delete-steps
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * An action step used to survive the observation that created it. The link is
 * ON DELETE SET NULL, so the step stayed open, stayed assigned, could go
 * overdue and still counted towards a coach's total in the Usage tab — with
 * nothing pointing at where it came from.
 *
 * The rule, decided 25 Aug:
 *
 *   * a step no other observation has touched goes with the observation
 *   * a step another observation HAS touched survives and moves there, because
 *     that is a coaching conversation that really happened
 *
 * Deleting a step is never quiet: the caller is refused with 409 and told
 * which steps would go, and has to ask again with force.
 *
 *   1. Deleting is refused, and names the step that would go
 *   2. With force, the step goes with the observation
 *   3. A mastered step is flagged as mastered in the refusal
 *   4. An extended step survives and moves to the observation that extended it
 *   5. A step mastered elsewhere survives and moves to that observation
 *   6. Deleting the observation that recorded a mastery leaves the step alone
 *   7. Nothing to lose means no refusal
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  people, schools, schoolYears, observations, actionSteps,
  rubricSets, rubricCategories, rubricDomains,
} from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP     = Date.now();
const ADMIN_EID = "U10";
const TEACHER   = `TST_ODS_TCH_${STAMP}`;
const FUTURE    = "2027-06-01";
const LATER     = "2027-07-01";

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

let adminJar: Jar;
let schoolId: number;
let yearId:   number;
let rubricSetId: number;

/** A published observation that assigns one action step. Returns both ids. */
async function observationAssigning(text: string, date: string) {
  const res = await request("POST", "/observations", {
    teacherId: TEACHER, rubricSetId, date, scores: {},
    strengths: "s", growthAreas: "g", status: "published",
    newActionStep: { text, dueDate: FUTURE },
  }, adminJar);
  assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
  const obsId = Number(res.body.id);
  const [step] = await db.select().from(actionSteps)
    .where(eq(actionSteps.assignedDuringObservationId, obsId));
  assert.ok(step, "fixture should have created a step");
  return { obsId, stepId: step.id };
}

const stepById = async (id: number) => {
  const [s] = await db.select().from(actionSteps).where(eq(actionSteps.id, id)).limit(1);
  return s;
};

describe("Deleting an observation and its action steps", () => {
  before(async () => {
    const [school] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(1);
    assert.ok(school, "Need a school");
    schoolId = school.id;

    const [year] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");
    yearId = year.id;

    const [rs] = await db.insert(rubricSets)
      .values({ slug: `tst-ods-rs-${STAMP}`, name: "Obs Delete RS",
                target: "TEACHER", isActive: true, schoolYearId: yearId })
      .returning({ id: rubricSets.id });
    assert.ok(rs);
    rubricSetId = rs.id;

    const [cat] = await db.insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "ODS Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat);
    await db.insert(rubricDomains).values({
      categoryId: cat.id, rubricSetId: rs.id, schoolYearId: yearId,
      slug: `tst-ods-dom-${STAMP}`, name: "ODS Domain", displayOrder: 1,
    });

    await db.insert(people).values({
      employeeId: TEACHER, firstName: "Ods", lastName: "Teacher",
      email: `${TEACHER}@example.com`.toLowerCase(),
      role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true,
    }).onConflictDoNothing();

    adminJar = await loginAs(ADMIN_EID);
  });

  after(async () => {
    await db.delete(actionSteps).where(eq(actionSteps.teacherEmployeeId, TEACHER)).catch(() => {});
    await db.delete(observations).where(eq(observations.observedEmployeeId, TEACHER)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, [TEACHER])).catch(() => {});
    await db.delete(rubricSets).where(eq(rubricSets.id, rubricSetId)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — deleting is refused, and names the step that would go", async () => {
    const { obsId, stepId } = await observationAssigning("Untouched step", "2026-11-01");

    const res = await request("DELETE", `/observations/${obsId}`, undefined, adminJar);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, "ACTION_STEPS_WOULD_BE_DELETED");
    assert.equal(res.body.stepsToDelete.length, 1);
    assert.equal(res.body.stepsToDelete[0].text, "Untouched step",
      "the warning has to name the step, not just count it");
    assert.equal(res.body.stepsToDelete[0].mastered, false);

    /* Refused means refused — nothing may have been written. */
    assert.ok(await stepById(stepId), "the step must still exist after a refusal");
    const [obs] = await db.select().from(observations).where(eq(observations.id, obsId));
    assert.ok(obs, "the observation must still exist after a refusal");
  });

  test("2 — with force, the step goes with the observation", async () => {
    const { obsId, stepId } = await observationAssigning("Goes with it", "2026-11-02");

    const res = await request("DELETE", `/observations/${obsId}?force=true`, undefined, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deletedActionSteps, 1);

    assert.equal(await stepById(stepId), undefined, "the step should be gone");
  });

  test("3 — a mastered step is flagged as mastered in the refusal", async () => {
    const { obsId, stepId } = await observationAssigning("Mastered here", "2026-11-03");

    /* Mastered during the SAME observation, so nothing else has touched it. */
    await db.update(actionSteps)
      .set({ status: "mastered", masteredAt: new Date(), masteredDuringObservationId: obsId })
      .where(eq(actionSteps.id, stepId));

    const res = await request("DELETE", `/observations/${obsId}`, undefined, adminJar);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.stepsToDelete[0].mastered, true,
      "completed work being deleted has to be called out specifically");

    const forced = await request("DELETE", `/observations/${obsId}?force=true`, undefined, adminJar);
    assert.equal(forced.status, 200, JSON.stringify(forced.body));
    assert.equal(await stepById(stepId), undefined);
  });

  test("4 — an extended step survives and moves to the observation that extended it", async () => {
    const { obsId, stepId } = await observationAssigning("Extended later", "2026-11-04");

    const extendObs = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-11-05", scores: {},
      strengths: "s", growthAreas: "g", status: "published",
      extendActionStep: { actionStepId: stepId, newDueDate: LATER },
    }, adminJar);
    assert.ok(extendObs.status === 200 || extendObs.status === 201, JSON.stringify(extendObs.body));
    const extendObsId = Number(extendObs.body.id);

    /* No refusal: nothing would be lost. */
    const res = await request("DELETE", `/observations/${obsId}`, undefined, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deletedActionSteps, 0);
    assert.equal(res.body.movedActionSteps, 1);

    const step = await stepById(stepId);
    assert.ok(step, "an extended step is a conversation that happened — it survives");
    assert.equal(step!.assignedDuringObservationId, extendObsId,
      "it should belong to the observation that last touched it");
  });

  test("5 — a step mastered elsewhere survives and moves to that observation", async () => {
    const { obsId, stepId } = await observationAssigning("Mastered elsewhere", "2026-11-06");

    const masterObs = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-11-07", scores: {},
      strengths: "s", growthAreas: "g", status: "published",
      masterActionStepId: stepId,
    }, adminJar);
    assert.ok(masterObs.status === 200 || masterObs.status === 201, JSON.stringify(masterObs.body));
    const masterObsId = Number(masterObs.body.id);

    const res = await request("DELETE", `/observations/${obsId}`, undefined, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.movedActionSteps, 1);

    const step = await stepById(stepId);
    assert.ok(step, "a completed coaching cycle is not collateral damage");
    assert.equal(step!.assignedDuringObservationId, masterObsId);
    assert.equal(step!.status, "mastered", "it stays mastered");
  });

  test("6 — deleting the observation that recorded a mastery leaves the step alone", async () => {
    const { obsId, stepId } = await observationAssigning("Mastered in obs B", "2026-11-08");

    const masterObs = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-11-09", scores: {},
      strengths: "s", growthAreas: "g", status: "published",
      masterActionStepId: stepId,
    }, adminJar);
    assert.ok(masterObs.status === 200 || masterObs.status === 201, JSON.stringify(masterObs.body));
    const masterObsId = Number(masterObs.body.id);

    /* Delete the one that MASTERED it. The step was created elsewhere, so
       nothing about it is being retracted — and it stays mastered, because
       the teacher did the work whether or not that meeting is on record. */
    const res = await request("DELETE", `/observations/${masterObsId}`, undefined, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const step = await stepById(stepId);
    assert.ok(step, "the step belongs to its own observation and is untouched");
    assert.equal(step!.status, "mastered");
    assert.equal(step!.assignedDuringObservationId, obsId, "it does not move");
  });

  test("7 — nothing to lose means no refusal", async () => {
    const res = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-11-10", scores: {},
      strengths: "s", growthAreas: "g", status: "published",
    }, adminJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));

    const del = await request("DELETE", `/observations/${Number(res.body.id)}`, undefined, adminJar);
    assert.equal(del.status, 200, "an observation with no action steps deletes as it always did");
    assert.equal(del.body.deletedActionSteps, 0);
  });
});
