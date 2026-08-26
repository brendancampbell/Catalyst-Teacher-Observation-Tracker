/**
 * Integration tests: a draft holds its action step, it does not assign one.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:draft-action-step
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * A draft used to create a real action step on its first autosave. That put a
 * live step on a teacher's list before anybody had decided to give it to them,
 * and discarding the draft left the step behind with nothing pointing at it —
 * still open, still assigned, still counted in the Usage tab.
 *
 * The intended step now rides on the draft in pending_action_step_text and
 * pending_action_step_due_date, and becomes real only at publish.
 *
 *   1. Saving a draft with an action step assigns nobody
 *   2. The draft carries it, and the drafts list gives it back
 *   3. Editing the draft changes what is held, still assigning nobody
 *   4. Publishing creates exactly one real step and clears what was held
 *   5. Discarding a draft leaves nothing behind — the whole point
 *   6. Publishing directly still assigns a step, as it always did
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
const TEACHER   = `TST_DAS_TCH_${STAMP}`;
const FUTURE    = "2027-05-03";

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

const stepsForTeacher = () =>
  db.select().from(actionSteps).where(eq(actionSteps.teacherEmployeeId, TEACHER));

const observationRow = (id: number) =>
  db.select({
    pendingText: observations.pendingActionStepText,
    pendingDue:  observations.pendingActionStepDueDate,
    status:      observations.status,
  }).from(observations).where(eq(observations.id, id)).limit(1);

let adminJar: Jar;
let schoolId: number;
let yearId:   number;
let rubricSetId: number;

describe("A draft holds its action step until publish", () => {
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
      .values({ slug: `tst-das-rs-${STAMP}`, name: "Draft Action Step RS",
                target: "TEACHER", isActive: true, schoolYearId: yearId })
      .returning({ id: rubricSets.id });
    assert.ok(rs);
    rubricSetId = rs.id;

    const [cat] = await db.insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "DAS Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat);
    await db.insert(rubricDomains).values({
      categoryId: cat.id, rubricSetId: rs.id, schoolYearId: yearId,
      slug: `tst-das-dom-${STAMP}`, name: "DAS Domain", displayOrder: 1,
    });

    await db.insert(people).values({
      employeeId: TEACHER, firstName: "Das", lastName: "Teacher",
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

  let draftId = 0;

  test("1 — saving a draft with an action step assigns nobody", async () => {
    const res = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-10-01", scores: {},
      strengths: "s", growthAreas: "g", status: "draft",
      newActionStep: { text: "Tighten the do-now", dueDate: FUTURE },
    }, adminJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
    draftId = Number(res.body.id);

    const steps = await stepsForTeacher();
    assert.equal(steps.length, 0,
      "a draft must not put a live action step on the teacher's list");
  });

  test("2 — the draft carries it, and the drafts list gives it back", async () => {
    const [row] = await observationRow(draftId);
    assert.equal(row!.pendingText, "Tighten the do-now");
    assert.equal(String(row!.pendingDue), FUTURE);

    /* Resuming reads this endpoint, and used to get nothing — the box came
       back empty while a real step sat behind it. */
    const list = await request("GET", "/observations/drafts", undefined, adminJar);
    assert.equal(list.status, 200);
    const mine = (list.body as Array<{ id: string; actionStepText?: string; actionStepDueDate?: string }>)
      .find((d) => Number(d.id) === draftId);
    assert.ok(mine, "the draft should be in the list");
    assert.equal(mine!.actionStepText, "Tighten the do-now");
    assert.equal(mine!.actionStepDueDate, FUTURE);
  });

  test("3 — editing the draft changes what is held, still assigning nobody", async () => {
    const res = await request("PUT", `/observations/${draftId}`, {
      status: "draft",
      newActionStep: { text: "Tighten the exit ticket", dueDate: FUTURE },
    }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [row] = await observationRow(draftId);
    assert.equal(row!.pendingText, "Tighten the exit ticket");
    assert.equal((await stepsForTeacher()).length, 0);
  });

  test("4 — publishing creates exactly one real step and clears what was held", async () => {
    const res = await request("PUT", `/observations/${draftId}`, {
      status: "published",
      newActionStep: { text: "Tighten the exit ticket", dueDate: FUTURE },
    }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const steps = await stepsForTeacher();
    assert.equal(steps.length, 1, "publishing should assign exactly one step");
    assert.equal(steps[0]!.text, "Tighten the exit ticket");
    assert.equal(steps[0]!.assignedDuringObservationId, draftId);

    const [row] = await observationRow(draftId);
    assert.equal(row!.status, "published");
    assert.equal(row!.pendingText, null,
      "nothing should still claim a step that now exists for real");
    assert.equal(row!.pendingDue, null);
  });

  test("5 — discarding a draft leaves nothing behind", async () => {
    /* The whole point. Before this, the step outlived the draft: open,
       assigned, able to go overdue, counted in the Usage tab, with nothing
       pointing at where it came from. */
    const created = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-10-02", scores: {},
      strengths: "s", growthAreas: "g", status: "draft",
      newActionStep: { text: "This one gets thrown away", dueDate: FUTURE },
    }, adminJar);
    assert.ok(created.status === 200 || created.status === 201, JSON.stringify(created.body));
    const throwaway = Number(created.body.id);

    const before = (await stepsForTeacher()).length;

    const del = await request("DELETE", `/observations/${throwaway}`, undefined, adminJar);
    assert.equal(del.status, 200, JSON.stringify(del.body));

    const after = await stepsForTeacher();
    assert.equal(after.length, before, "discarding a draft must not leave a step behind");
    assert.ok(!after.some((s) => s.text === "This one gets thrown away"));
  });

  test("6 — publishing directly still assigns a step", async () => {
    const before = (await stepsForTeacher()).length;
    const res = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-10-03", scores: {},
      strengths: "s", growthAreas: "g", status: "published",
      newActionStep: { text: "Straight to published", dueDate: FUTURE },
    }, adminJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));

    const after = await stepsForTeacher();
    assert.equal(after.length, before + 1, "the ordinary path must be unchanged");
    assert.ok(after.some((s) => s.text === "Straight to published"));
  });
});
