/**
 * Regression test: AI qualitative context does NOT expose coaching notes from
 * a teacher's previous school after they transfer to a new school.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:ai-teacher-transfer-scope
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses:
 *  - /api/auth/dev-login to establish a real session as a SCHOOL_LEADER
 *  - /api/ai/chat/context (dev-only) to invoke the full production path:
 *      auth middleware → resolveSchoolId → getScopedPeople →
 *      buildCombinedContext → buildGlowsGrowsData → buildActionStepsData
 *    and returns the assembled context string without calling Claude.
 *
 * Transfer Scenario
 * ─────────────────
 * Teacher "Transfer" is originally at School B:
 *   - An observation is recorded AT School B (observations.schoolId = School B)
 *     with unique sentinel text in strengths/growthAreas.
 *   - An action step is created linked to that School B observation.
 *
 * Teacher then transfers to School A (people.schoolId updated to School A).
 *
 * School A's SCHOOL_LEADER calls /api/ai/chat/context.
 * Because people.schoolId is now School A, the teacher appears in School A's
 * personIds — BUT their School B observations/steps must NOT appear in the
 * School A context.
 *
 * The test verifies:
 *   1. School A leader gets a 200 with a valid context string.
 *   2. School A's own teacher sentinel text IS present.
 *   3. Transferred teacher's School-B observation sentinels are NOT present.
 *   4. Transferred teacher's School-B action step sentinel is NOT present.
 *   5. A new observation for the transferred teacher AT School A IS present.
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
  schoolYears,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── Unique sentinel strings ─────────────────────────────────────────────── */
const SCHOOL_A_NATIVE_STRENGTH  = "TST_XFER_SCHOOL_A_NATIVE_STRENGTH";
const SCHOOL_A_NATIVE_STEP      = "TST_XFER_SCHOOL_A_NATIVE_STEP";

const XFER_SCHOOL_B_STRENGTH    = "TST_XFER_TEACHER_SCHOOL_B_STRENGTH";
const XFER_SCHOOL_B_GROWTH      = "TST_XFER_TEACHER_SCHOOL_B_GROWTH";
const XFER_SCHOOL_B_STEP        = "TST_XFER_TEACHER_SCHOOL_B_STEP";

const XFER_SCHOOL_A_STRENGTH    = "TST_XFER_TEACHER_SCHOOL_A_STRENGTH";

/* Legacy observation with NO schoolId — must never appear in any scoped context */
const XFER_NULL_SCHOOL_STRENGTH = "TST_XFER_TEACHER_NULL_SCHOOL_STRENGTH";

/* ── Employee IDs ────────────────────────────────────────────────────────── */
const LEADER_A_EID   = "TST_XFER_LEADER_A";
const NATIVE_A_EID   = "TST_XFER_NATIVE_A";
const XFER_EID       = "TST_XFER_TEACHER";

/* ── Cleanup tracking ────────────────────────────────────────────────────── */
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

/* ── HTTP helpers ────────────────────────────────────────────────────────── */

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

/* ── Test suite ──────────────────────────────────────────────────────────── */

describe("AI qualitative context — teacher transfer school-scope isolation (HTTP)", () => {
  let leaderAJar: Jar;

  before(async () => {
    /* ── Schools ──────────────────────────────────────────────────────────── */
    const [schA] = await db
      .insert(schools)
      .values({
        displayName:  "Test School A (XFer)",
        fullName:     "Test School A Full (XFer)",
        abbreviation: "TST-XSCA",
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

    const [schB] = await db
      .insert(schools)
      .values({
        displayName:  "Test School B (XFer)",
        fullName:     "Test School B Full (XFer)",
        abbreviation: "TST-XSCB",
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

    /* ── Rubric set ───────────────────────────────────────────────────────── */
    const rsSlug = `tst-xfer-rs-${Date.now()}`;
    const [activeYear] = await db.select({ id: schoolYears.id }).from(schoolYears).where(eq(schoolYears.status, "active")).limit(1);
    const activeSchoolYearId = activeYear!.id;

    const [rs] = await db
      .insert(rubricSets)
      .values({ slug: rsSlug, name: "Test XFer RS", target: "TEACHER", isActive: true, schoolYearId: activeSchoolYearId })
      .returning({ id: rubricSets.id });
    assert.ok(rs, "Failed to insert rubric set");
    createdRubricSetId = rs.id;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "XFer Category", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat, "Failed to insert rubric category");
    createdCategoryId = cat.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({ categoryId: cat.id, rubricSetId: rs.id, schoolYearId: activeSchoolYearId, slug: `tst-xfer-domain-${Date.now()}`, name: "XFer Domain", displayOrder: 1 })
      .returning({ id: rubricDomains.id });
    assert.ok(dom, "Failed to insert rubric domain");
    createdDomainId = dom.id;

    /* ── People ───────────────────────────────────────────────────────────── */
    await db.insert(people).values([
      {
        employeeId:               LEADER_A_EID,
        firstName:                "Leader",
        lastName:                 "XFerA",
        email:                    "tst.xfer.leader.a@example.com",
        role:                     "SCHOOL_LEADER",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               NATIVE_A_EID,
        firstName:                "Native",
        lastName:                 "XFerNativeA",
        email:                    "tst.xfer.native.a@example.com",
        role:                     "COACH",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: true,
      },
      {
        /* Transferred teacher: currently at School A (post-transfer) */
        employeeId:               XFER_EID,
        firstName:                "Transferred",
        lastName:                 "XFerTeacher",
        email:                    "tst.xfer.teacher@example.com",
        role:                     "COACH",
        schoolId:                 SCHOOL_A_ID,   /* now at School A */
        isActive:                 true,
        includeInFeedbackTracker: true,
      },
    ]).onConflictDoNothing();

    /* ── Observations ─────────────────────────────────────────────────────── */

    /* School B observation for transferred teacher (pre-transfer, schoolId = B) */
    const [obsB] = await db
      .insert(observations)
      .values({
        schoolYearId:                1,
        schoolId:           SCHOOL_B_ID,          /* recorded at School B */
        observedEmployeeId: XFER_EID,
        rubricSetId:        rs.id,
        observerEmployeeId: null,
        date:               "2026-01-15",
        observer:           "XFer Test Observer",
        status:             "published",
        target:             "TEACHER",
        strengths:          XFER_SCHOOL_B_STRENGTH,
        growthAreas:        XFER_SCHOOL_B_GROWTH,
      })
      .returning({ id: observations.id });
    assert.ok(obsB, "Failed to insert School B observation for transferred teacher");
    createdObsIds.push(obsB.id);

    /* School A observation for transferred teacher (post-transfer, schoolId = A) */
    const [obsXferA] = await db
      .insert(observations)
      .values({
        schoolYearId:                1,
        schoolId:           SCHOOL_A_ID,          /* recorded at School A */
        observedEmployeeId: XFER_EID,
        rubricSetId:        rs.id,
        observerEmployeeId: null,
        date:               "2026-06-01",
        observer:           "XFer Test Observer",
        status:             "published",
        target:             "TEACHER",
        strengths:          XFER_SCHOOL_A_STRENGTH,
        growthAreas:        null,
      })
      .returning({ id: observations.id });
    assert.ok(obsXferA, "Failed to insert School A observation for transferred teacher");
    createdObsIds.push(obsXferA.id);

    /* School A observation for the native School A teacher */
    const [obsA] = await db
      .insert(observations)
      .values({
        schoolYearId:                1,
        schoolId:           SCHOOL_A_ID,
        observedEmployeeId: NATIVE_A_EID,
        rubricSetId:        rs.id,
        observerEmployeeId: null,
        date:               "2026-06-01",
        observer:           "XFer Test Observer",
        status:             "published",
        target:             "TEACHER",
        strengths:          SCHOOL_A_NATIVE_STRENGTH,
        growthAreas:        null,
      })
      .returning({ id: observations.id });
    assert.ok(obsA, "Failed to insert School A native observation");
    createdObsIds.push(obsA.id);

    /* Legacy null-school observation for the transferred teacher (schoolId omitted/null).
       This simulates an old row that pre-dates the school-tagging requirement.
       It must NOT appear in any school-scoped AI context (fail-closed). */
    const [obsNull] = await db
      .insert(observations)
      .values({
        schoolYearId:                1,
        /* schoolId deliberately omitted — defaults to null */
        observedEmployeeId: XFER_EID,
        rubricSetId:        rs.id,
        observerEmployeeId: null,
        date:               "2025-09-01",
        observer:           "XFer Test Observer",
        status:             "published",
        target:             "TEACHER",
        strengths:          XFER_NULL_SCHOOL_STRENGTH,
        growthAreas:        null,
      })
      .returning({ id: observations.id });
    assert.ok(obsNull, "Failed to insert null-school legacy observation");
    createdObsIds.push(obsNull.id);

    /* ── Action steps ─────────────────────────────────────────────────────── */

    /* School B action step linked to the School B observation */
    const [stepB] = await db
      .insert(actionSteps)
      .values({
        schoolYearId:                1,
        teacherEmployeeId:           XFER_EID,
        assignedDuringObservationId: obsB.id,    /* links to School B obs */
        text:                        XFER_SCHOOL_B_STEP,
        dueDate:                     "2026-03-01",
        status:                      "open",
      })
      .returning({ id: actionSteps.id });
    assert.ok(stepB, "Failed to insert School B action step");
    createdStepIds.push(stepB.id);

    /* School A native action step (no linked observation) */
    const [stepA] = await db
      .insert(actionSteps)
      .values({
        schoolYearId:                1,
        teacherEmployeeId: NATIVE_A_EID,
        text:              SCHOOL_A_NATIVE_STEP,
        dueDate:           "2026-08-01",
        status:            "open",
      })
      .returning({ id: actionSteps.id });
    assert.ok(stepA, "Failed to insert School A native action step");
    createdStepIds.push(stepA.id);

    /* ── Login ────────────────────────────────────────────────────────────── */
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
      .where(inArray(people.employeeId, [LEADER_A_EID, NATIVE_A_EID, XFER_EID]))
      .catch(() => {});
    if (createdSchoolBId !== null) {
      await db.delete(schools).where(eq(schools.id, createdSchoolBId)).catch(() => {});
    }
    if (createdSchoolAId !== null) {
      await db.delete(schools).where(eq(schools.id, createdSchoolAId)).catch(() => {});
    }
  });

  /* ── 1. Basic connectivity ──────────────────────────────────────────────── */

  test("1 — School A leader calling /ai/chat/context → 200", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* ── 2. School A native data IS present ─────────────────────────────────── */

  test("2 — context contains native School A observation sentinel", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(
      typeof contextStr === "string" && contextStr.includes(SCHOOL_A_NATIVE_STRENGTH),
      `Context must include native School A strength sentinel.\nExcerpt:\n${contextStr?.slice(0, 600)}`,
    );
  });

  test("3 — context contains native School A action step sentinel", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(
      typeof contextStr === "string" && contextStr.includes(SCHOOL_A_NATIVE_STEP),
      `Context must include native School A action step sentinel.\nExcerpt:\n${contextStr?.slice(0, 600)}`,
    );
  });

  test("4 — context contains transferred teacher's School A observation sentinel", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(
      typeof contextStr === "string" && contextStr.includes(XFER_SCHOOL_A_STRENGTH),
      `Context must include transferred teacher's School A strength sentinel.\nExcerpt:\n${contextStr?.slice(0, 600)}`,
    );
  });

  /* ── 3. School B stale data is NOT present ──────────────────────────────── */

  test("5 — context does NOT contain transferred teacher's School B strength sentinel", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(typeof contextStr === "string", "contextStr must be a string");
    assert.ok(
      !contextStr.includes(XFER_SCHOOL_B_STRENGTH),
      `School B strength sentinel must NOT appear in School A's context.\nExcerpt:\n${contextStr?.slice(0, 600)}`,
    );
  });

  test("6 — context does NOT contain transferred teacher's School B growth sentinel", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(typeof contextStr === "string", "contextStr must be a string");
    assert.ok(
      !contextStr.includes(XFER_SCHOOL_B_GROWTH),
      `School B growth sentinel must NOT appear in School A's context.\nExcerpt:\n${contextStr?.slice(0, 600)}`,
    );
  });

  test("7 — context does NOT contain transferred teacher's School B action step sentinel", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(typeof contextStr === "string", "contextStr must be a string");
    assert.ok(
      !contextStr.includes(XFER_SCHOOL_B_STEP),
      `School B action step sentinel must NOT appear in School A's context.\nExcerpt:\n${contextStr?.slice(0, 600)}`,
    );
  });

  /* ── 4. Legacy null-school observations are excluded (fail-closed) ────────── */

  test("8 — context does NOT contain legacy null-school observation sentinel for transferred teacher", async () => {
    const res = await request(
      "POST",
      "/ai/chat/context",
      { message: "Tell me about teacher feedback" },
      leaderAJar,
    );
    assert.equal(res.status, 200);
    const { contextStr } = res.body as { contextStr: string };
    assert.ok(typeof contextStr === "string", "contextStr must be a string");
    assert.ok(
      !contextStr.includes(XFER_NULL_SCHOOL_STRENGTH),
      `Null-school legacy observation sentinel must NOT appear in School A's context (fail-closed).\nExcerpt:\n${contextStr?.slice(0, 600)}`,
    );
  });
});
