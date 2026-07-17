/**
 * Regression tests for score validation on POST and PUT /api/observations.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:observation-score-validation
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. POST with a non-numeric score value → 400, nothing written to DB
 *   2. POST with a valid score but unknown domainSlug → 400, nothing written to DB
 *   3. PUT with a non-numeric score value → 400, existing scores preserved
 *   4. PUT with a valid score but unknown domainSlug → 400, existing scores preserved
 *   5. POST with all-valid inputs → 201 (smoke test)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  observations, observationScores, people, schools, rubricSets,
  rubricCategories, rubricDomains, schoolYears,
} from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* Resolved dynamically in before() */
let SCHOOL_ID: number;
let RUBRIC_SET_ID: number;
let RUBRIC_SET_SLUG: string;
let VALID_DOMAIN_SLUG: string;

/* Temporary test entity IDs */
const ADMIN_EID          = "TST_SCORE_VAL_ADMIN";
const TEACHER_EID        = "TST_SCORE_VAL_TEACHER";

/* Track created IDs for cleanup */
const createdObsIds: number[] = [];
let createdRubricSetId: number | null = null;
let createdCategoryId: number | null = null;
let createdDomainId: number | null = null;

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

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

/* ── Test state ───────────────────────────────────────────────────────────── */

let adminJar: Jar;

describe("Observation score input validation — POST and PUT", () => {
  before(async () => {
    /* Resolve a school ID from the live DB */
    const firstSchool = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(1);
    assert.equal(firstSchool.length, 1, "Need at least 1 school in the DB to run this test");
    SCHOOL_ID = firstSchool[0]!.id;

    /* Create a dedicated TEACHER-target rubric set for full control */
    const slug = `tst-score-val-rs-${Date.now()}`;
    const [activeYear] = await db.select({ id: schoolYears.id }).from(schoolYears).where(eq(schoolYears.status, "active")).limit(1);
    const activeSchoolYearId = activeYear!.id;

    const [rs] = await db
      .insert(rubricSets)
      .values({ slug, name: "Test Score Val RS", target: "TEACHER", isActive: true, schoolYearId: activeSchoolYearId })
      .returning({ id: rubricSets.id, slug: rubricSets.slug });
    assert.ok(rs, "Failed to insert test rubric set");
    createdRubricSetId = rs.id;
    RUBRIC_SET_ID      = rs.id;
    RUBRIC_SET_SLUG    = rs.slug;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "Test Score Val Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat, "Failed to insert test rubric category");
    createdCategoryId = cat.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({ categoryId: cat.id, rubricSetId: rs.id, schoolYearId: activeSchoolYearId, slug: `tst-score-val-dom-${Date.now()}`, name: "Test Domain", displayOrder: 1 })
      .returning({ id: rubricDomains.id, slug: rubricDomains.slug });
    assert.ok(dom, "Failed to insert test rubric domain");
    createdDomainId   = dom.id;
    VALID_DOMAIN_SLUG = dom.slug;

    /* Create a NETWORK_ADMIN test user (can create observations for any person) */
    await db.insert(people).values({
      employeeId:               ADMIN_EID,
      firstName:                "Test",
      lastName:                 "ScoreValAdmin",
      email:                    "tst.score.val.admin@example.com",
      role:                     "NETWORK_ADMIN",
      schoolId:                 null,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

    /* Create a teacher person in the school (needed for TEACHER-target POST) */
    await db.insert(people).values({
      employeeId:               TEACHER_EID,
      firstName:                "Test",
      lastName:                 "ScoreValTeacher",
      email:                    "tst.score.val.teacher@example.com",
      role:                     "NO_ACCESS",
      schoolId:                 SCHOOL_ID,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

    /* Login as the NETWORK_ADMIN */
    adminJar = await loginAs(ADMIN_EID);
  });

  after(async () => {
    /* Clean up any observations created (scores cascade-delete automatically) */
    for (const id of createdObsIds) {
      await db.delete(observations).where(eq(observations.id, id)).catch(() => {});
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

  /* 1 ── POST with non-numeric score value → 400 ──────────────────────────── */

  test("1 — POST with a non-numeric score value returns 400 and nothing is written", async () => {
    const countBefore = (await db.select({ id: observations.id }).from(observations)).length;

    const res = await request(
      "POST",
      "/observations",
      {
        observedEmployeeId: TEACHER_EID,
        rubricSetId:        RUBRIC_SET_ID,
        date:               "2025-07-01",
        status:             "published",
        scores:             { [VALID_DOMAIN_SLUG]: "garbage" },
      },
      adminJar,
    );

    assert.equal(
      res.status,
      400,
      `Expected 400 for non-numeric score, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    /* Confirm no observation row was inserted */
    const countAfter = (await db.select({ id: observations.id }).from(observations)).length;
    assert.equal(countAfter, countBefore, "An observation row was inserted despite invalid scores");
  });

  /* 2 ── POST with unknown domainSlug → 400 ──────────────────────────────── */

  test("2 — POST with an unknown domainSlug returns 400 and nothing is written", async () => {
    const countBefore = (await db.select({ id: observations.id }).from(observations)).length;

    const res = await request(
      "POST",
      "/observations",
      {
        observedEmployeeId: TEACHER_EID,
        rubricSetId:        RUBRIC_SET_ID,
        date:               "2025-07-01",
        status:             "published",
        scores:             { "completely_unknown_slug_xyz": 0.5 },
      },
      adminJar,
    );

    assert.equal(
      res.status,
      400,
      `Expected 400 for unknown slug, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const countAfter = (await db.select({ id: observations.id }).from(observations)).length;
    assert.equal(countAfter, countBefore, "An observation row was inserted despite unknown slug");
  });

  /* 3 ── PUT with non-numeric score value → 400, existing scores preserved ── */

  test("3 — PUT with a non-numeric score value returns 400 and preserves existing scores", async () => {
    /* Create a valid observation with an initial score to protect */
    const [obs] = await db
      .insert(observations)
      .values({
        schoolYearId:                1,
        observedEmployeeId: TEACHER_EID,
        schoolId:           null,
        rubricSetId:        RUBRIC_SET_ID,
        observerEmployeeId: ADMIN_EID,
        date:               "2025-07-02",
        observer:           "Score Val Test",
        status:             "published",
        target:             "TEACHER",
      })
      .returning({ id: observations.id });
    assert.ok(obs, "Failed to create test observation for PUT test");
    createdObsIds.push(obs.id);

    /* Insert a valid initial score */
    await db.insert(observationScores).values({
      observationId: obs.id,
      domainSlug:    VALID_DOMAIN_SLUG,
      score:         1,
    });

    const res = await request(
      "PUT",
      `/observations/${obs.id}`,
      { scores: { [VALID_DOMAIN_SLUG]: "garbage" } },
      adminJar,
    );

    assert.equal(
      res.status,
      400,
      `Expected 400 for non-numeric score on PUT, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    /* Existing score must be preserved (not deleted) */
    const remaining = await db
      .select()
      .from(observationScores)
      .where(eq(observationScores.observationId, obs.id));
    assert.equal(
      remaining.length,
      1,
      `Expected 1 preserved score, found ${remaining.length}. The PUT validation did not guard the delete.`,
    );
    assert.equal(
      remaining[0]!.score,
      1,
      `Preserved score should be 1, got ${remaining[0]!.score}`,
    );
  });

  /* 4 ── PUT with unknown domainSlug → 400, existing scores preserved ──────── */

  test("4 — PUT with an unknown domainSlug returns 400 and preserves existing scores", async () => {
    /* Create a valid observation with an initial score to protect */
    const [obs] = await db
      .insert(observations)
      .values({
        schoolYearId:                1,
        observedEmployeeId: TEACHER_EID,
        schoolId:           null,
        rubricSetId:        RUBRIC_SET_ID,
        observerEmployeeId: ADMIN_EID,
        date:               "2025-07-03",
        observer:           "Score Val Test",
        status:             "published",
        target:             "TEACHER",
      })
      .returning({ id: observations.id });
    assert.ok(obs, "Failed to create test observation for PUT test");
    createdObsIds.push(obs.id);

    await db.insert(observationScores).values({
      observationId: obs.id,
      domainSlug:    VALID_DOMAIN_SLUG,
      score:         0.5,
    });

    const res = await request(
      "PUT",
      `/observations/${obs.id}`,
      { scores: { "completely_unknown_slug_xyz": 0.5 } },
      adminJar,
    );

    assert.equal(
      res.status,
      400,
      `Expected 400 for unknown slug on PUT, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    /* Existing score must be preserved */
    const remaining = await db
      .select()
      .from(observationScores)
      .where(eq(observationScores.observationId, obs.id));
    assert.equal(
      remaining.length,
      1,
      `Expected 1 preserved score, found ${remaining.length}. The PUT validation did not guard the delete.`,
    );
    assert.equal(
      remaining[0]!.score,
      0.5,
      `Preserved score should be 0.5, got ${remaining[0]!.score}`,
    );
  });

  /* 5 ── PUT with bad scores must not mutate the observation row ──────────── */

  test("5 — PUT with invalid scores returns 400 and does not mutate the observation row", async () => {
    /* Create a draft observation so we can attempt to publish it via PUT */
    const [obs] = await db
      .insert(observations)
      .values({
        schoolYearId:                1,
        observedEmployeeId: TEACHER_EID,
        schoolId:           null,
        rubricSetId:        RUBRIC_SET_ID,
        observerEmployeeId: ADMIN_EID,
        date:               "2025-07-05",
        observer:           "Score Val Test",
        status:             "draft",
        target:             "TEACHER",
      })
      .returning({ id: observations.id, status: observations.status, editedAt: observations.editedAt });
    assert.ok(obs, "Failed to create test observation for mutation guard test");
    createdObsIds.push(obs.id);

    /* Attempt to publish with an invalid score — the status should NOT flip to published */
    const res = await request(
      "PUT",
      `/observations/${obs.id}`,
      {
        status: "published",
        scores: { [VALID_DOMAIN_SLUG]: "garbage" },
      },
      adminJar,
    );

    assert.equal(
      res.status,
      400,
      `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    /* Verify the DB row is unchanged */
    const rowAfter = await db.query.observations.findFirst({
      where: eq(observations.id, obs.id),
    });
    assert.ok(rowAfter, "Observation row should still exist");
    assert.equal(
      rowAfter.status,
      "draft",
      `Status should still be 'draft', but got '${rowAfter.status}' — PUT mutated the row before returning 400`,
    );
    assert.equal(
      rowAfter.editedAt?.toISOString() ?? null,
      obs.editedAt?.toISOString() ?? null,
      "editedAt should not have changed on a failed PUT",
    );
  });

  /* 6 ── POST with all-valid inputs → 201 ─────────────────────────────────── */

  test("6 — POST with all-valid inputs returns 201", async () => {
    const res = await request(
      "POST",
      "/observations",
      {
        observedEmployeeId: TEACHER_EID,
        rubricSetId:        RUBRIC_SET_ID,
        date:               "2025-07-04",
        status:             "published",
        scores:             { [VALID_DOMAIN_SLUG]: 1 },
      },
      adminJar,
    );

    assert.equal(
      res.status,
      201,
      `Expected 201 for valid observation, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const body = res.body as { id: string };
    assert.ok(body.id, "Response should include an id");
    createdObsIds.push(Number(body.id));
  });
});

/* Ensure pool closes when done so the process exits */
process.on("exit", () => { pool.end().catch(() => {}); });
