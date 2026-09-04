/**
 * Regression test: PUT /api/observations/:id refuses to ADD an action step to
 * an observation from a school year that has closed.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:action-step-closed-year
 *
 * Requires the dev server to be running (NODE_ENV=development).
 *
 * Why the refusal rather than filing it somewhere. An action step can now be
 * added to an observation after it was filed, and an observation can be years
 * old. A step is scoped to a school year, and every list, the edit endpoint and
 * the mastery endpoint read only the ACTIVE one — a prior-year step already
 * answers 404 there (see test-action-step-school-year-scope.ts). A step filed
 * against a closed year would therefore be owed by a teacher who never sees it
 * and cannot be marked done by anyone. Filing it under the active year instead
 * would count last year's visit against this year's work. So neither: the
 * request is refused and says so.
 *
 * Scenarios:
 *   1. PUT with newActionStep on an observation from a CLOSED year → 400,
 *      and no action step row is created
 *   2. PUT with newActionStep on an observation from the ACTIVE year → created
 *      (positive control), filed against the observation's own year
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  observations,
  people,
  schools,
  rubricSets,
  schoolYears,
  actionSteps,
} from "@workspace/db/schema";
import { eq, ne, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const ADMIN_EID   = "U10";             /* Brendan Campbell — NETWORK_ADMIN */
const TEACHER_EID = "TST_ASCY_TCH";

/* ── HTTP helpers ─────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function request(
  method: string,
  path: string,
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar.cookieHeader) headers["Cookie"] = jar.cookieHeader;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let responseBody: unknown;
  try { responseBody = await res.json(); } catch { responseBody = null; }
  return { status: res.status, body: responseBody };
}

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  const setCookie = res.headers.get("set-cookie");
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: status ${res.status}`);
  assert.ok(setCookie, "dev-login should return Set-Cookie");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

/* ── Test state ───────────────────────────────────────────────────────── */

let adminJar: Jar;
let testSchoolId: number;
let rubricSetId: number;
let activeYearId: number;
let closedYearId: number;
/* Made by this test only when the database had no inactive year to borrow. */
let createdClosedYear = false;
let closedObsId = 0;
let activeObsId = 0;

async function createObservation(course: string): Promise<number> {
  const res = await request("POST", "/observations", {
    teacherId:     TEACHER_EID,
    rubricSetId:   rubricSetId,
    date:          "2026-07-18",
    time:          "09:00",
    course,
    scores:        {},
    strengths:     "Clear explanations",
    growthAreas:   "Cold-calling",
    isWalkthrough: false,
    status:        "published",
  }, adminJar);
  assert.ok(
    res.status === 200 || res.status === 201,
    `POST /observations expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  const body = res.body as { id?: string | number };
  assert.ok(body.id, "Observation response must include id");
  return Number(body.id);
}

/* ── Suite ────────────────────────────────────────────────────────────── */

describe("PUT /observations/:id — adding an action step after the fact", () => {
  before(async () => {
    const [firstSchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(1);
    assert.ok(firstSchool, "Need at least 1 school in the DB");
    testSchoolId = firstSchool.id;

    const [firstRubric] = await db
      .select({ id: rubricSets.id })
      .from(rubricSets)
      .orderBy(asc(rubricSets.id))
      .limit(1);
    assert.ok(firstRubric, "Need at least 1 rubric set in the DB");
    rubricSetId = firstRubric.id;

    const activeYear = await db.query.schoolYears.findFirst({
      where: eq(schoolYears.status, "active"),
    });
    assert.ok(activeYear, "Need an active school year");
    activeYearId = activeYear.id;

    /* A year that is not the open one. Borrow an existing inactive year if the
       database has one; otherwise make one and take it away again after. */
    const inactiveYear = await db.query.schoolYears.findFirst({
      where: ne(schoolYears.status, "active"),
    });
    if (inactiveYear) {
      closedYearId = inactiveYear.id;
    } else {
      /* Timestamped so cleanup-test-school-years.ts can recognise it as this
         suite's own — see lib/db/src/test-year-patterns.ts. */
      const [made] = await db.insert(schoolYears).values({
        name:   `TST Closed Year ${Date.now()}`,
        status: "inactive",
      }).returning();
      closedYearId = made!.id;
      createdClosedYear = true;
    }

    /* NO_ACCESS is what a teacher is — see CLAUDE.md. */
    await db.insert(people).values([
      {
        employeeId: TEACHER_EID,
        firstName: "ClosedYear",
        lastName: "Teacher",
        email: "closedyear.teacher@test.example.com",
        role: "NO_ACCESS",
        schoolId: testSchoolId,
        isActive: true,
        includeInFeedbackTracker: true,
      },
    ]).onConflictDoNothing();

    adminJar = await loginAs(ADMIN_EID);

    closedObsId = await createObservation("Closed Year Guard Test");
    activeObsId = await createObservation("Open Year Control Test");

    /* An observation is always created in the open year, so the closed-year
       case has to be made by hand. This is the state a real observation
       reaches on its own the moment the year rolls over. */
    await db.update(observations)
      .set({ schoolYearId: closedYearId })
      .where(eq(observations.id, closedObsId));
  });

  after(async () => {
    for (const id of [closedObsId, activeObsId]) {
      if (!id) continue;
      await db.delete(actionSteps)
        .where(eq(actionSteps.assignedDuringObservationId, id))
        .catch(() => {});
      await db.delete(observations).where(eq(observations.id, id)).catch(() => {});
    }
    await db.delete(people)
      .where(inArray(people.employeeId, [TEACHER_EID]))
      .catch(() => {});
    if (createdClosedYear && closedYearId) {
      await db.delete(schoolYears).where(eq(schoolYears.id, closedYearId)).catch(() => {});
    }
  });

  /* ── Scenario 1 ────────────────────────────────────────────────────── */
  test("1 — refuses a new action step on an observation from a closed year", async () => {
    const putRes = await request("PUT", `/observations/${closedObsId}`, {
      newActionStep: {
        text:    "Closed year: this step must not be created",
        dueDate: "2027-06-01",
      },
    }, adminJar);

    assert.equal(
      putRes.status,
      400,
      `PUT expected 400, got ${putRes.status}: ${JSON.stringify(putRes.body)}`,
    );
    const body = putRes.body as { error?: string };
    assert.match(
      String(body.error ?? ""),
      /school year that has closed/i,
      `The refusal should say why: ${JSON.stringify(putRes.body)}`,
    );

    const steps = await db.query.actionSteps.findMany({
      where: eq(actionSteps.assignedDuringObservationId, closedObsId),
    });
    assert.equal(steps.length, 0, "No action step should have been created");
  });

  /* ── Scenario 2 — positive control ─────────────────────────────────── */
  test("2 — creates the step on an observation from the open year, filed against that year", async () => {
    const putRes = await request("PUT", `/observations/${activeObsId}`, {
      newActionStep: {
        text:    "Open year: name students before posing cold-call questions",
        dueDate: "2027-06-01",
      },
    }, adminJar);

    assert.ok(
      putRes.status === 200 || putRes.status === 201,
      `PUT expected 200/201, got ${putRes.status}: ${JSON.stringify(putRes.body)}`,
    );

    const steps = await db.query.actionSteps.findMany({
      where: eq(actionSteps.assignedDuringObservationId, activeObsId),
    });
    assert.equal(steps.length, 1, `Expected exactly 1 step, found ${steps.length}`);
    assert.equal(steps[0]!.status, "open");
    assert.equal(
      steps[0]!.schoolYearId,
      activeYearId,
      "The step belongs to the observation's own year, which is the open one",
    );
  });

  /* ── Scenario 3 ────────────────────────────────────────────────────── */
  test("3 — an observation from a closed year still saves everything else", async () => {
    const putRes = await request("PUT", `/observations/${closedObsId}`, {
      strengths: "Closed year: the wording is still correctable",
    }, adminJar);

    assert.ok(
      putRes.status === 200 || putRes.status === 201,
      `PUT expected 200/201, got ${putRes.status}: ${JSON.stringify(putRes.body)}`,
    );
    const saved = await db.query.observations.findFirst({
      where: eq(observations.id, closedObsId),
    });
    assert.equal(saved!.strengths, "Closed year: the wording is still correctable");
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
