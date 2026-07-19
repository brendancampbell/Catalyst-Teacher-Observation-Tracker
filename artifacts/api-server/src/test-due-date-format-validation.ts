/**
 * Regression tests for ISO-date format validation on dueDate fields.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:due-date-format-validation
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   a. POST /observations with newActionStep.dueDate: "abc" → 400 (not 500)
 *   b. PUT  /observations/:id with newActionStep.dueDate: "abc" → 400 (not 500)
 *   c. PATCH /action-steps/:id with dueDate: "abc" → 400 (not 500)
 *   d. PATCH /action-steps/:id with valid future dueDate → 200 (smoke test)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  observations,
  actionSteps,
  people,
  schools,
  rubricSets,
  rubricCategories,
  rubricDomains,
  schoolYears,
} from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── Unique employee IDs for this test run ──────────────────────────────── */
const ADMIN_EID   = "TST_DDVAL_ADMIN";
const TEACHER_EID = "TST_DDVAL_TEACHER";

/* ── State resolved in before() ─────────────────────────────────────────── */
let SCHOOL_ID: number;
let RUBRIC_SET_ID: number;
let RUBRIC_SET_SLUG: string;

/* IDs created during setup — cleaned up in after() */
let createdObsId: number | null = null;
let createdStepId: number | null = null;
let createdRubricSetId: number | null = null;
let createdCategoryId: number | null = null;
let createdDomainId: number | null = null;

/* ── HTTP helpers ────────────────────────────────────────────────────────── */

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
  assert.ok(setCookie, "dev-login should return a Set-Cookie header");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

/* ── Test state ─────────────────────────────────────────────────────────── */

let adminJar: Jar;

/* ── Suite ──────────────────────────────────────────────────────────────── */

describe("Due-date ISO format validation — POST obs, PUT obs, PATCH action-step", () => {
  before(async () => {
    /* Resolve a school and the active school year */
    const [firstSchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(1);
    assert.ok(firstSchool, "Need at least 1 school in the DB to run this test");
    SCHOOL_ID = firstSchool.id;

    const [activeYear] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);
    assert.ok(activeYear, "Need an active school year in the DB");
    const activeYearId = activeYear.id;

    /* Create a TEACHER-target rubric set */
    const rsSlug = `tst-ddval-rs-${Date.now()}`;
    const [rs] = await db
      .insert(rubricSets)
      .values({ slug: rsSlug, name: "Due Date Val RS", target: "TEACHER", isActive: true, schoolYearId: activeYearId })
      .returning({ id: rubricSets.id, slug: rubricSets.slug });
    assert.ok(rs, "Failed to insert test rubric set");
    createdRubricSetId = rs.id;
    RUBRIC_SET_ID      = rs.id;
    RUBRIC_SET_SLUG    = rs.slug;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "DDVal Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat, "Failed to insert test rubric category");
    createdCategoryId = cat.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({
        categoryId: cat.id,
        rubricSetId: rs.id,
        schoolYearId: activeYearId,
        slug: `tst-ddval-dom-${Date.now()}`,
        name: "DDVal Domain",
        displayOrder: 1,
      })
      .returning({ id: rubricDomains.id });
    assert.ok(dom, "Failed to insert test rubric domain");
    createdDomainId = dom.id;

    /* Create test people */
    await db.insert(people).values({
      employeeId:               ADMIN_EID,
      firstName:                "DDVal",
      lastName:                 "Admin",
      email:                    "tst.ddval.admin@example.com",
      role:                     "NETWORK_ADMIN",
      schoolId:                 null,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

    await db.insert(people).values({
      employeeId:               TEACHER_EID,
      firstName:                "DDVal",
      lastName:                 "Teacher",
      email:                    "tst.ddval.teacher@example.com",
      role:                     "NO_ACCESS",
      schoolId:                 SCHOOL_ID,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

    adminJar = await loginAs(ADMIN_EID);

    /* Seed an observation for the PUT test (scenario b) */
    const [obs] = await db
      .insert(observations)
      .values({
        schoolYearId:       activeYearId,
        observedEmployeeId: TEACHER_EID,
        schoolId:           null,
        rubricSetId:        RUBRIC_SET_ID,
        observerEmployeeId: ADMIN_EID,
        date:               "2025-07-01",
        status:             "published",
        target:             "TEACHER",
      })
      .returning({ id: observations.id });
    assert.ok(obs, "Failed to seed test observation");
    createdObsId = obs.id;

    /* Seed an action step for PATCH tests (scenarios c, d) */
    const [step] = await db
      .insert(actionSteps)
      .values({
        schoolYearId:     activeYearId,
        snapshotSchoolId: SCHOOL_ID,
        teacherEmployeeId: TEACHER_EID,
        assignedByEmployeeId: ADMIN_EID,
        text:    "DDVal test action step",
        dueDate: "2099-12-31",
        status:  "open",
      })
      .returning({ id: actionSteps.id });
    assert.ok(step, "Failed to seed test action step");
    createdStepId = step.id;
  });

  after(async () => {
    if (createdStepId !== null) {
      await db.delete(actionSteps).where(eq(actionSteps.id, createdStepId)).catch(() => {});
    }
    if (createdObsId !== null) {
      await db.delete(observations).where(eq(observations.id, createdObsId)).catch(() => {});
    }
    if (createdDomainId !== null) {
      await db.delete(rubricDomains).where(eq(rubricDomains.id, createdDomainId)).catch(() => {});
    }
    if (createdCategoryId !== null) {
      await db.delete(rubricCategories).where(eq(rubricCategories.id, createdCategoryId)).catch(() => {});
    }
    if (createdRubricSetId !== null) {
      await db.delete(rubricSets).where(eq(rubricSets.id, createdRubricSetId)).catch(() => {});
    }
    await db.delete(people).where(inArray(people.employeeId, [ADMIN_EID, TEACHER_EID])).catch(() => {});
  });

  /* a ── POST /observations with bad newActionStep.dueDate → 400, not 500 ─── */

  test("a — POST /observations with newActionStep.dueDate 'abc' returns 400, not 500", async () => {
    const res = await request(
      "POST",
      "/observations",
      {
        observedEmployeeId: TEACHER_EID,
        rubricSetId:        RUBRIC_SET_ID,
        date:               "2025-07-01",
        status:             "published",
        scores:             {},
        newActionStep:      { text: "Some action step", dueDate: "abc" },
      },
      adminJar,
    );

    assert.equal(
      res.status,
      400,
      `Expected 400 for malformed dueDate on POST obs, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const body = res.body as { error?: string };
    assert.ok(
      typeof body.error === "string" && body.error.includes("ISO date"),
      `Expected error message mentioning 'ISO date', got: ${JSON.stringify(body)}`,
    );
  });

  /* b ── PUT /observations/:id with bad newActionStep.dueDate → 400, not 500 ─ */

  test("b — PUT /observations/:id with newActionStep.dueDate 'abc' returns 400, not 500", async () => {
    assert.ok(createdObsId !== null, "Observation must have been seeded in before()");
    const res = await request(
      "PUT",
      `/observations/${createdObsId}`,
      {
        newActionStep: { text: "Some action step", dueDate: "abc" },
      },
      adminJar,
    );

    assert.equal(
      res.status,
      400,
      `Expected 400 for malformed dueDate on PUT obs, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const body = res.body as { error?: string };
    assert.ok(
      typeof body.error === "string" && body.error.includes("ISO date"),
      `Expected error message mentioning 'ISO date', got: ${JSON.stringify(body)}`,
    );
  });

  /* c ── PATCH /action-steps/:id with bad dueDate → 400, not 500 ──────────── */

  test("c — PATCH /action-steps/:id with dueDate 'abc' returns 400, not 500", async () => {
    assert.ok(createdStepId !== null, "Action step must have been seeded in before()");
    const res = await request(
      "PATCH",
      `/action-steps/${createdStepId}`,
      { dueDate: "abc" },
      adminJar,
    );

    assert.equal(
      res.status,
      400,
      `Expected 400 for malformed dueDate on PATCH action-step, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const body = res.body as { error?: string };
    assert.ok(
      typeof body.error === "string" && body.error.includes("ISO date"),
      `Expected error message mentioning 'ISO date', got: ${JSON.stringify(body)}`,
    );
  });

  /* d ── PATCH /action-steps/:id with valid future dueDate → 200 (smoke) ──── */

  test("d — PATCH /action-steps/:id with valid future dueDate returns 200", async () => {
    assert.ok(createdStepId !== null, "Action step must have been seeded in before()");
    const res = await request(
      "PATCH",
      `/action-steps/${createdStepId}`,
      { dueDate: "2099-06-15" },
      adminJar,
    );

    assert.equal(
      res.status,
      200,
      `Expected 200 for valid future dueDate on PATCH action-step, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const body = res.body as { ok?: boolean; actionStep?: { dueDate?: string } };
    assert.equal(body.ok, true, "Response body should have ok: true");
    assert.equal(
      body.actionStep?.dueDate,
      "2099-06-15",
      `Expected updated dueDate '2099-06-15', got '${body.actionStep?.dueDate}'`,
    );
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
