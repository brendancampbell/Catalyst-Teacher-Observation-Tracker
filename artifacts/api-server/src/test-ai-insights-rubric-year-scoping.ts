/**
 * Regression test: GET /api/ai/insights must resolve rubric slugs against
 * the ACTIVE school year, not the oldest row with that slug.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:ai-insights-rubric-year-scoping
 *
 * Scenario
 * ────────
 * Two rubric sets share the slug TST-INSIGHTS-YR-SLUG:
 *   - "old set"    in an inactive school year (id < active id → sorts first)
 *   - "active set" in the active school year
 *
 * A teacher has a published observation + scores recorded against the ACTIVE
 * rubric set.  When the school leader queries /api/ai/insights?rubric=<slug>,
 * getRubricSetId must resolve to the ACTIVE set so the scores are found and
 * topStrength / topGrowth are returned as non-null.
 *
 * Before the fix, getRubricSetId did WHERE slug = $1 LIMIT 1 with no year
 * filter, so it returned the old set's id and the score JOIN produced zero
 * rows → { topStrength: null, topGrowth: null }.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  people,
  schools,
  observations,
  observationScores,
  rubricSets,
  rubricCategories,
  rubricDomains,
  schoolYears,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;
const SLUG = `TST-INSIGHTS-YR-SLUG-${Date.now()}`;

/* ── Cleanup tracking ────────────────────────────────────────────────────── */
let createdSchoolId:        number | null = null;
let createdOldYearId:       number | null = null;
let createdOldRubricSetId:  number | null = null;
let createdActiveRsId:      number | null = null;
let createdCategoryId:      number | null = null;
let createdDomainId:        number | null = null;
let createdObsId:           number | null = null;
const createdEids:          string[] = [];

process.on("exit", () => { pool.end().catch(() => {}); });

/* ── HTTP helpers ────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "dev-login must return Set-Cookie");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

async function getJson(path: string, jar: Jar): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: jar.cookieHeader },
  });
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/* ── Fixture setup ───────────────────────────────────────────────────────── */

async function setup() {
  /* Active school year */
  const [activeYear] = await db
    .select({ id: schoolYears.id })
    .from(schoolYears)
    .where(eq(schoolYears.status, "active"))
    .limit(1);
  assert.ok(activeYear, "No active school year found");
  const activeYearId = activeYear.id;

  /* Create an INACTIVE school year so the old rubric set sorts first */
  const [oldYear] = await db
    .insert(schoolYears)
    .values({ name: `TST-INSIGHTS-OLD-YR-${Date.now()}`, status: "inactive" })
    .returning({ id: schoolYears.id });
  assert.ok(oldYear, "Failed to create old school year");
  createdOldYearId = oldYear.id;

  /* Create test school */
  const [sch] = await db
    .insert(schools)
    .values({
      displayName:  `TST Insights Yr School ${Date.now()}`,
      fullName:     `TST Insights Yr School Full ${Date.now()}`,
      abbreviation: `TSTIYR${Date.now() % 10000}`,
      region:       "Boston",
      gradeSpan:    "ES",
      isActive:     true,
      isArchived:   false,
      isHomeOffice: false,
    })
    .returning({ id: schools.id });
  assert.ok(sch, "Failed to create test school");
  createdSchoolId = sch.id;

  /* Create OLD rubric set with same slug (will have a lower id, sorts first) */
  const [oldRs] = await db
    .insert(rubricSets)
    .values({ slug: SLUG, name: `TST Old RS ${SLUG}`, target: "TEACHER", isActive: false, schoolYearId: createdOldYearId })
    .returning({ id: rubricSets.id });
  assert.ok(oldRs, "Failed to create old rubric set");
  createdOldRubricSetId = oldRs.id;

  /* Create ACTIVE rubric set with same slug in the active year */
  const [activeRs] = await db
    .insert(rubricSets)
    .values({ slug: SLUG, name: `TST Active RS ${SLUG}`, target: "TEACHER", isActive: true, schoolYearId: activeYearId })
    .returning({ id: rubricSets.id });
  assert.ok(activeRs, "Failed to create active rubric set");
  createdActiveRsId = activeRs.id;

  /* Create a rubric category and domain under the active rubric set */
  const [cat] = await db
    .insert(rubricCategories)
    .values({ rubricSetId: createdActiveRsId, name: "TST Category Insights", displayOrder: 0, schoolYearId: activeYearId })
    .returning({ id: rubricCategories.id });
  assert.ok(cat, "Failed to create rubric category");
  createdCategoryId = cat.id;

  const domainSlug = `tst-domain-insights-${Date.now()}`;
  const [dom] = await db
    .insert(rubricDomains)
    .values({
      rubricSetId:  createdActiveRsId,
      categoryId:   createdCategoryId,
      slug:         domainSlug,
      name:         "TST Insights Domain",
      displayOrder: 0,
      schoolYearId: activeYearId,
    })
    .returning({ id: rubricDomains.id });
  assert.ok(dom, "Failed to create rubric domain");
  createdDomainId = dom.id;

  /* Create school leader */
  const leaderEid = `TST_INS_YR_LEADER_${Date.now()}`;
  createdEids.push(leaderEid);
  await db.insert(people).values({
    employeeId:               leaderEid,
    firstName:                "Insights",
    lastName:                 "Leader",
    email:                    `${leaderEid}@test.example`,
    role:                     "SCHOOL_LEADER",
    schoolId:                 createdSchoolId,
    isActive:                 true,
    includeInFeedbackTracker: false,
  });

  /* Create coach to be observed (includeInFeedbackTracker=true is the key field) */
  const teacherEid = `TST_INS_YR_COACH_${Date.now()}`;
  createdEids.push(teacherEid);
  await db.insert(people).values({
    employeeId:               teacherEid,
    firstName:                "Insights",
    lastName:                 "Coach",
    email:                    `${teacherEid}@test.example`,
    role:                     "COACH",
    schoolId:                 createdSchoolId,
    isActive:                 true,
    includeInFeedbackTracker: true,
  });

  /* Create published observation for the teacher using the ACTIVE rubric set */
  const [obs] = await db
    .insert(observations)
    .values({
      observedEmployeeId: teacherEid,
      observerEmployeeId: leaderEid,
      schoolId:           createdSchoolId,
      rubricSetId:        createdActiveRsId,
      schoolYearId:       activeYearId,
      status:             "published",
      date:               new Date().toISOString().slice(0, 10),
    })
    .returning({ id: observations.id });
  assert.ok(obs, "Failed to create observation");
  createdObsId = obs.id;

  /* Add a score so buildDomainAverages returns a result */
  await db.insert(observationScores).values({
    observationId: createdObsId,
    domainSlug:    domainSlug,
    score:         0.75,
  });

  return { leaderEid, activeYearId, domainSlug };
}

/* ── Teardown ────────────────────────────────────────────────────────────── */

async function teardown() {
  if (createdObsId !== null) {
    await db.delete(observationScores).where(eq(observationScores.observationId, createdObsId));
    await db.delete(observations).where(eq(observations.id, createdObsId));
  }
  if (createdEids.length > 0) await db.delete(people).where(inArray(people.employeeId, createdEids));
  if (createdDomainId !== null) await db.delete(rubricDomains).where(eq(rubricDomains.id, createdDomainId));
  if (createdCategoryId !== null) await db.delete(rubricCategories).where(eq(rubricCategories.id, createdCategoryId));
  if (createdActiveRsId !== null) await db.delete(rubricSets).where(eq(rubricSets.id, createdActiveRsId));
  if (createdOldRubricSetId !== null) await db.delete(rubricSets).where(eq(rubricSets.id, createdOldRubricSetId));
  if (createdSchoolId !== null) await db.delete(schools).where(eq(schools.id, createdSchoolId));
  if (createdOldYearId !== null) await db.delete(schoolYears).where(eq(schoolYears.id, createdOldYearId));
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("GET /ai/insights — rubric slug resolves to active school year", () => {
  let leaderJar: Jar;

  before(async () => {
    const { leaderEid } = await setup();
    leaderJar = await loginAs(leaderEid);
  });

  after(teardown);

  test("returns 200 with non-null topStrength and topGrowth", async () => {
    const { status, body } = await getJson(
      `/ai/insights?rubric=${encodeURIComponent(SLUG)}`,
      leaderJar,
    );

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);

    const b = body as { topStrength: unknown; topGrowth: unknown };
    assert.notEqual(
      b.topStrength,
      null,
      `topStrength should be non-null — getRubricSetId returned the old-year set instead of the active one`,
    );
    assert.notEqual(
      b.topGrowth,
      null,
      `topGrowth should be non-null — getRubricSetId returned the old-year set instead of the active one`,
    );
  });

  test("old-year rubric set id (lower id) must not be used — active-year id resolves the slug", async () => {
    assert.ok(createdOldRubricSetId !== null && createdActiveRsId !== null, "rubric set ids must be set");
    assert.ok(
      createdOldRubricSetId < createdActiveRsId,
      `Old rubric set (id=${createdOldRubricSetId}) must have a lower id than active (id=${createdActiveRsId}) ` +
      `to prove that a bare LIMIT 1 without year filter would pick the wrong one`,
    );
  });
});
