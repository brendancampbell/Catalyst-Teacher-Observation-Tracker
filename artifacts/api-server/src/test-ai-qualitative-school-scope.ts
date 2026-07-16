/**
 * Regression test: AI qualitative context stays within the selected school.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:ai-qualitative-school-scope
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses:
 *  - /api/auth/dev-login to establish a real session as a SCHOOL_LEADER
 *  - /api/ai/chat/context (dev-only) to invoke the full production path:
 *      auth middleware → resolveSchoolId → getScopedPeople →
 *      buildCombinedContext → buildGlowsGrowsData → buildActionStepsData →
 *      buildQualitativeSection
 *    and returns the assembled context string without calling Claude.
 *
 * Scenario
 * ────────
 * School A  →  SCHOOL_LEADER "LeaderA" + teacher "QScopeA" (includeInFeedbackTracker=true)
 * School B  →  teacher "QScopeB" (includeInFeedbackTracker=true)
 *
 * Each teacher has a published observation with unique sentinel text in
 * strengths/growthAreas, and a unique open action step.
 *
 * The SCHOOL_LEADER for School A calls /api/ai/chat/context. The test then:
 *  1. Verifies 200 OK
 *  2. Verifies School A sentinel text appears in the qualitative context
 *  3. Verifies School B sentinel text does NOT appear in the context
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  people,
  schools,
  observations,
  actionSteps,
  rubricSets,
  rubricCategories,
  rubricDomains,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── Unique sentinel strings ────────────────────────────────────────────────── */
const TEACHER_A_STRENGTHS   = "TST_QSCOPE_A_STRENGTH_UNIQUE";
const TEACHER_A_GROWTH      = "TST_QSCOPE_A_GROWTH_UNIQUE";
const TEACHER_A_ACTION_STEP = "TST_QSCOPE_A_STEP_UNIQUE";

const TEACHER_B_STRENGTHS   = "TST_QSCOPE_B_STRENGTH_UNIQUE";
const TEACHER_B_GROWTH      = "TST_QSCOPE_B_GROWTH_UNIQUE";
const TEACHER_B_ACTION_STEP = "TST_QSCOPE_B_STEP_UNIQUE";

/* ── Employee IDs ───────────────────────────────────────────────────────────── */
const LEADER_A_EID  = "TST_QSCOPE_LEADER_A";
const TEACHER_A_EID = "TST_QSCOPE_TCH_A";
const TEACHER_B_EID = "TST_QSCOPE_TCH_B";

/* ── Cleanup tracking ───────────────────────────────────────────────────────── */
let SCHOOL_A_ID: number;
let SCHOOL_B_ID: number;

let createdSchoolAId: number | null = null;
let createdSchoolBId: number | null = null;
let createdRubricSetId: number | null = null;
let createdCategoryId: number | null = null;
let createdDomainId: number | null = null;
const createdObsIds: number[] = [];
const createdStepIds: number[] = [];

process.on("exit", () => { pool.end().catch(() => {}); });

/* ── HTTP helpers ───────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function request(
  method: string,
  path: string,
  body: unknown,
  jar?: Jar,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar?.cookieHeader) headers["Cookie"] = jar.cookieHeader;

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
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  assert.ok(setCookie, "dev-login must return a Set-Cookie header");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

/* ── Test suite ─────────────────────────────────────────────────────────────── */

describe("AI qualitative context — school-scope isolation (HTTP)", () => {
  let leaderAJar: Jar;

  before(async () => {
    /* Create School A */
    const [schA] = await db
      .insert(schools)
      .values({
        displayName:  "Test School A (QScope)",
        fullName:     "Test School A Full (QScope)",
        abbreviation: "TST-QSCA",
        region:       "Boston",
        gradeSpan:    "MS",
        isActive:     true,
        isArchived:   false,
        isHomeOffice: false,
      })
      .returning({ id: schools.id });
    assert.ok(schA, "Failed to create School A");
    SCHOOL_A_ID = schA.id;
    createdSchoolAId = schA.id;

    /* Create School B */
    const [schB] = await db
      .insert(schools)
      .values({
        displayName:  "Test School B (QScope)",
        fullName:     "Test School B Full (QScope)",
        abbreviation: "TST-QSCB",
        region:       "NYC",
        gradeSpan:    "HS",
        isActive:     true,
        isArchived:   false,
        isHomeOffice: false,
      })
      .returning({ id: schools.id });
    assert.ok(schB, "Failed to create School B");
    SCHOOL_B_ID = schB.id;
    createdSchoolBId = schB.id;

    /* Minimal rubric set (required FK for observations) */
    const rsSlug = `tst-qscope-rs-${Date.now()}`;
    const [rs] = await db
      .insert(rubricSets)
      .values({ slug: rsSlug, name: "Test QScope RS", target: "TEACHER", isActive: true })
      .returning({ id: rubricSets.id });
    assert.ok(rs, "Failed to insert rubric set");
    createdRubricSetId = rs.id;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "QScope Category", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat, "Failed to insert rubric category");
    createdCategoryId = cat.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({ categoryId: cat.id, rubricSetId: rs.id, slug: "tst_qscope_domain", name: "QScope Domain", displayOrder: 1 })
      .returning({ id: rubricDomains.id });
    assert.ok(dom, "Failed to insert rubric domain");
    createdDomainId = dom.id;

    /* Create people */
    await db.insert(people).values([
      {
        employeeId:               LEADER_A_EID,
        firstName:                "Leader",
        lastName:                 "QScopeA",
        email:                    "tst.qscope.leader.a@example.com",
        role:                     "SCHOOL_LEADER",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               TEACHER_A_EID,
        firstName:                "Teacher",
        lastName:                 "QScopeA",
        email:                    "tst.qscope.tch.a@example.com",
        role:                     "COACH",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: true,
      },
      {
        employeeId:               TEACHER_B_EID,
        firstName:                "Teacher",
        lastName:                 "QScopeB",
        email:                    "tst.qscope.tch.b@example.com",
        role:                     "COACH",
        schoolId:                 SCHOOL_B_ID,
        isActive:                 true,
        includeInFeedbackTracker: true,
      },
    ]).onConflictDoNothing();

    /* Published observation for Teacher A (School A) with unique sentinel text */
    const [obsA] = await db
      .insert(observations)
      .values({
        schoolId:           SCHOOL_A_ID,
        observedEmployeeId: TEACHER_A_EID,
        rubricSetId:        rs.id,
        observerEmployeeId: null,
        date:               "2026-06-01",
        observer:           "QScope Test Observer",
        status:             "published",
        target:             "TEACHER",
        strengths:          TEACHER_A_STRENGTHS,
        growthAreas:        TEACHER_A_GROWTH,
      })
      .returning({ id: observations.id });
    assert.ok(obsA, "Failed to insert Teacher A observation");
    createdObsIds.push(obsA.id);

    /* Published observation for Teacher B (School B) with unique sentinel text */
    const [obsB] = await db
      .insert(observations)
      .values({
        schoolId:           SCHOOL_B_ID,
        observedEmployeeId: TEACHER_B_EID,
        rubricSetId:        rs.id,
        observerEmployeeId: null,
        date:               "2026-06-01",
        observer:           "QScope Test Observer",
        status:             "published",
        target:             "TEACHER",
        strengths:          TEACHER_B_STRENGTHS,
        growthAreas:        TEACHER_B_GROWTH,
      })
      .returning({ id: observations.id });
    assert.ok(obsB, "Failed to insert Teacher B observation");
    createdObsIds.push(obsB.id);

    /* Action step for Teacher A */
    const [stepA] = await db
      .insert(actionSteps)
      .values({
        teacherEmployeeId: TEACHER_A_EID,
        text:              TEACHER_A_ACTION_STEP,
        dueDate:           "2026-08-01",
        status:            "open",
      })
      .returning({ id: actionSteps.id });
    assert.ok(stepA, "Failed to insert Teacher A action step");
    createdStepIds.push(stepA.id);

    /* Action step for Teacher B */
    const [stepB] = await db
      .insert(actionSteps)
      .values({
        teacherEmployeeId: TEACHER_B_EID,
        text:              TEACHER_B_ACTION_STEP,
        dueDate:           "2026-08-01",
        status:            "open",
      })
      .returning({ id: actionSteps.id });
    assert.ok(stepB, "Failed to insert Teacher B action step");
    createdStepIds.push(stepB.id);

    /* Log in as School A's SCHOOL_LEADER */
    leaderAJar = await loginAs(LEADER_A_EID);
  });

  after(async () => {
    if (createdStepIds.length > 0) {
      await db.delete(actionSteps).where(inArray(actionSteps.id, createdStepIds)).catch(() => {});
    }
    if (createdObsIds.length > 0) {
      await db.delete(observations).where(inArray(observations.id, createdObsIds)).catch(() => {});
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
    await db
      .delete(people)
      .where(inArray(people.employeeId, [LEADER_A_EID, TEACHER_A_EID, TEACHER_B_EID]))
      .catch(() => {});
    if (createdSchoolBId !== null) {
      await db.delete(schools).where(eq(schools.id, createdSchoolBId)).catch(() => {});
    }
    if (createdSchoolAId !== null) {
      await db.delete(schools).where(eq(schools.id, createdSchoolAId)).catch(() => {});
    }
  });

  /* ── 1. Unauthenticated request is rejected ─────────────────────────────── */

  test("1 — unauthenticated request to /ai/chat/context → 401", async () => {
    const res = await request("POST", "/ai/chat/context", { message: "Tell me about teacher feedback" });
    assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
  });

  /* ── 2–5. SCHOOL_LEADER for School A sees only School A data ────────────── */

  test("2 — SCHOOL_LEADER for School A calling /ai/chat/context → 200", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("3 — context contains School A qualitative glows sentinel text", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(
      typeof contextStr === "string" && contextStr.includes(TEACHER_A_STRENGTHS),
      `Context must include School A strengths sentinel "${TEACHER_A_STRENGTHS}".\nContext excerpt:\n${contextStr?.slice(0, 500)}`,
    );
  });

  test("4 — context contains School A action step sentinel text", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(
      typeof contextStr === "string" && contextStr.includes(TEACHER_A_ACTION_STEP),
      `Context must include School A action step sentinel "${TEACHER_A_ACTION_STEP}".\nContext excerpt:\n${contextStr?.slice(0, 500)}`,
    );
  });

  test("5 — context does NOT contain School B qualitative glows or grows", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(typeof contextStr === "string", "contextStr must be a string");
    assert.ok(
      !contextStr.includes(TEACHER_B_STRENGTHS),
      `School B strengths sentinel "${TEACHER_B_STRENGTHS}" must NOT appear in School A's context`,
    );
    assert.ok(
      !contextStr.includes(TEACHER_B_GROWTH),
      `School B growth sentinel "${TEACHER_B_GROWTH}" must NOT appear in School A's context`,
    );
  });

  test("6 — context does NOT contain School B action step text", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(typeof contextStr === "string", "contextStr must be a string");
    assert.ok(
      !contextStr.includes(TEACHER_B_ACTION_STEP),
      `School B action step sentinel "${TEACHER_B_ACTION_STEP}" must NOT appear in School A's context`,
    );
  });

  test("7 — context does NOT contain School B teacher name", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(typeof contextStr === "string", "contextStr must be a string");
    /* "QScopeB" is the last name unique to Teacher B (Teacher A is "QScopeA") */
    assert.ok(
      !contextStr.includes("QScopeB"),
      `School B teacher name "QScopeB" must NOT appear in School A's AI context`,
    );
  });
});
