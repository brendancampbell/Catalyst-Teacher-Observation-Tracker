/**
 * Integration tests: extending an action step instead of duplicating it
 * (backlog #16).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:action-step-extend
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * "Repeat last action step" used to copy the text and due date into the new
 * action step box, so saving created a SECOND open step saying the same thing.
 * These cover the behaviour that replaced it:
 *
 *   1. Extending moves the date on the SAME step — no second step appears
 *   2. It records an extension, and the list endpoint reports the count and
 *      the original due date
 *   3. Draft autosave (repeated PUT) does not stack up one extension per save
 *   4. Extending and assigning in one observation is refused
 *   5. A mastered step cannot be extended
 *   6. Another teacher's step cannot be extended
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { observations, people, schools, rubricSets, actionSteps, actionStepExtensions } from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP       = Date.now();
const ADMIN_EID   = "U10";
const TEACHER_EID = `TST_EXT_TCH_${STAMP}`;
const OTHER_EID   = `TST_EXT_OTH_${STAMP}`;
const ALL_EIDS    = [TEACHER_EID, OTHER_EID];

/* Comfortably in the future, so these never age into failures. */
const FUTURE_A = "2027-05-03";
const FUTURE_B = "2027-06-14";

type Jar = { cookieHeader: string };

async function request(method: string, path: string, body: unknown, jar: Jar) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: jar.cookieHeader },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* empty body */ }
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

const stepsFor = (eid: string) =>
  db.select().from(actionSteps).where(eq(actionSteps.teacherEmployeeId, eid)).orderBy(asc(actionSteps.id));

const extensionsFor = (stepId: number) =>
  db.select().from(actionStepExtensions)
    .where(eq(actionStepExtensions.actionStepId, stepId))
    .orderBy(asc(actionStepExtensions.id));

let adminJar: Jar;
let schoolId: number;
let rubricSetId: number;
let obsIds: number[] = [];

/** A published observation of the test teacher; returns its id. */
async function newObservation(extra: Record<string, unknown> = {}): Promise<number> {
  const res = await request("POST", "/observations", {
    teacherId: TEACHER_EID, rubricSetId, date: "2026-07-18", time: "09:00",
    course: "Extend Test", scores: {}, strengths: "s", growthAreas: "g",
    isWalkthrough: false, status: "published", ...extra,
  }, adminJar);
  assert.ok(res.status === 200 || res.status === 201,
    `POST /observations failed: ${res.status} ${JSON.stringify(res.body)}`);
  const id = Number(res.body.id);
  obsIds.push(id);
  return id;
}

describe("Extending an action step", () => {
  before(async () => {
    const [school] = await db.select({ id: schools.id }).from(schools).orderBy(asc(schools.id)).limit(1);
    assert.ok(school, "Need a school");
    schoolId = school.id;

    const [rubric] = await db.select({ id: rubricSets.id }).from(rubricSets).orderBy(asc(rubricSets.id)).limit(1);
    assert.ok(rubric, "Need a rubric set");
    rubricSetId = rubric.id;

    await db.insert(people).values([
      { employeeId: TEACHER_EID, firstName: "Ext", lastName: "Teacher", email: `${TEACHER_EID}@example.com`,
        role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true },
      { employeeId: OTHER_EID, firstName: "Ext", lastName: "Other", email: `${OTHER_EID}@example.com`,
        role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true },
    ]).onConflictDoNothing();

    adminJar = await loginAs(ADMIN_EID);
  });

  after(async () => {
    /* action_step_extensions cascades from action_steps, which cascades from
       people — but delete explicitly so a failure names the table. */
    const steps = await stepsFor(TEACHER_EID).catch(() => []);
    for (const s of steps) {
      await db.delete(actionStepExtensions).where(eq(actionStepExtensions.actionStepId, s.id)).catch(() => {});
    }
    await db.delete(actionSteps).where(inArray(actionSteps.teacherEmployeeId, ALL_EIDS)).catch(() => {});
    if (obsIds.length) {
      await db.delete(observations).where(inArray(observations.id, obsIds)).catch(() => {});
    }
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — extending moves the date on the same step, creating no second step", async () => {
    await newObservation({ newActionStep: { text: "Tighten transitions", dueDate: FUTURE_A } });
    const [step] = await stepsFor(TEACHER_EID);
    assert.ok(step, "the first observation should have created one step");
    assert.equal(step.dueDate, FUTURE_A);

    await newObservation({ extendActionStep: { actionStepId: step.id, newDueDate: FUTURE_B, note: "out sick" } });

    const after = await stepsFor(TEACHER_EID);
    assert.equal(after.length, 1, `expected still ONE step, got ${after.length} — this is the bug being fixed`);
    assert.equal(after[0]!.dueDate, FUTURE_B, "the due date should have moved");
    assert.equal(after[0]!.text, "Tighten transitions", "the wording must not change");
  });

  test("2 — the extension is recorded, with the original due date", async () => {
    const [step] = await stepsFor(TEACHER_EID);
    const exts = await extensionsFor(step!.id);
    assert.equal(exts.length, 1);
    assert.equal(exts[0]!.previousDueDate, FUTURE_A, "keeps what it was due before");
    assert.equal(exts[0]!.newDueDate, FUTURE_B);
    assert.equal(exts[0]!.note, "out sick");

    const res = await request("GET", `/action-steps?teacherEmployeeId=${TEACHER_EID}`, undefined, adminJar);
    assert.equal(res.status, 200);
    const row = (res.body as any[]).find((r) => r.id === step!.id);
    assert.equal(row.extensionCount, 1);
    assert.equal(row.originalDueDate, FUTURE_A,
      "the profile shows what it was ORIGINALLY due, not the date before the last push");
  });

  test("3 — repeated saves of one draft do not stack extensions", async () => {
    /* Draft autosave calls PUT over and over. Without the guard this would
       add an extension row and push the date on every keystroke — the same
       duplication this feature removes, one level down. */
    const [step] = await stepsFor(TEACHER_EID);
    const draft = await request("POST", "/observations", {
      teacherId: TEACHER_EID, rubricSetId, date: "2026-07-19", scores: {},
      strengths: "s", growthAreas: "g", isWalkthrough: false, status: "draft",
    }, adminJar);
    const draftId = Number(draft.body.id);
    obsIds.push(draftId);

    for (const d of [FUTURE_A, FUTURE_B, FUTURE_B]) {
      const res = await request("PUT", `/observations/${draftId}`, {
        status: "draft", extendActionStep: { actionStepId: step!.id, newDueDate: d },
      }, adminJar);
      assert.equal(res.status, 200, `PUT failed: ${JSON.stringify(res.body)}`);
    }

    const exts = await extensionsFor(step!.id);
    const fromDraft = exts.filter((e) => e.extendedDuringObservationId === draftId);
    assert.equal(fromDraft.length, 1, `three saves should leave ONE extension, got ${fromDraft.length}`);
    assert.equal(fromDraft[0]!.newDueDate, FUTURE_B, "the latest date wins");
  });

  test("4 — extending and assigning in the same observation is refused", async () => {
    const [step] = await stepsFor(TEACHER_EID);
    const res = await request("POST", "/observations", {
      teacherId: TEACHER_EID, rubricSetId, date: "2026-07-20", scores: {},
      strengths: "s", growthAreas: "g", isWalkthrough: false, status: "published",
      newActionStep:    { text: "Something new", dueDate: FUTURE_B },
      extendActionStep: { actionStepId: step!.id, newDueDate: FUTURE_B },
    }, adminJar);
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
    assert.match(String(res.body.error), /either extend .* or assign a new one/i);
  });

  test("5 — a mastered step cannot be extended", async () => {
    const [step] = await stepsFor(TEACHER_EID);
    await db.update(actionSteps).set({ status: "mastered" }).where(eq(actionSteps.id, step!.id));

    const res = await request("POST", "/observations", {
      teacherId: TEACHER_EID, rubricSetId, date: "2026-07-21", scores: {},
      strengths: "s", growthAreas: "g", isWalkthrough: false, status: "published",
      extendActionStep: { actionStepId: step!.id, newDueDate: FUTURE_B },
    }, adminJar);
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /open action step/i);

    await db.update(actionSteps).set({ status: "open" }).where(eq(actionSteps.id, step!.id));
  });

  test("6 — another teacher's step cannot be extended", async () => {
    /* Otherwise observing one teacher could move a different teacher's
       deadline. */
    const [step] = await stepsFor(TEACHER_EID);
    const res = await request("POST", "/observations", {
      teacherId: OTHER_EID, rubricSetId, date: "2026-07-22", scores: {},
      strengths: "s", growthAreas: "g", isWalkthrough: false, status: "published",
      extendActionStep: { actionStepId: step!.id, newDueDate: FUTURE_B },
    }, adminJar);
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /different teacher/i);
  });
});
