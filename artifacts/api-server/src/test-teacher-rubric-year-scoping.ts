/**
 * Regression test: GET /api/teachers/:id must resolve the ?quarter= rubric
 * slug against the ACTIVE school year, not the oldest row with that slug.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:teacher-rubric-year-scoping
 *
 * Scenario
 * ────────
 * Two rubric sets share the slug TST-TEACHER-YR-SLUG:
 *   - "old set"    in an inactive school year (lower id → sorts first)
 *   - "active set" in the active school year
 *
 * A teacher has a published observation, with a score, recorded against the
 * ACTIVE rubric set — a teacher who has been observed this year. Asking for
 * that teacher by the slug must resolve to the ACTIVE set and return the
 * observation.
 *
 * Before the fix, the route did WHERE slug = $1 with no year filter, so it
 * got the old year's set and then filtered observations by that set's id —
 * zero rows. The teacher came back with observations: [], looking as though
 * they had never been observed. No error, no empty state, just silence.
 *
 * This is the trap the fix removes: nothing calls this endpoint today, so the
 * one-line change is easy to lose again and would fail the same quiet way.
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
  schoolYears,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;
const SLUG = `TST-TEACHER-YR-SLUG-${Date.now()}`;
const DOMAIN_SLUG = `tst-domain-teacher-yr-${Date.now()}`;

/* ── Cleanup tracking ────────────────────────────────────────────────────── */
let createdSchoolId:       number | null = null;
let createdOldYearId:      number | null = null;
let createdOldRubricSetId: number | null = null;
let createdActiveRsId:     number | null = null;
let createdObsId:          number | null = null;
const createdEids:         string[] = [];

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
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: jar.cookieHeader } });
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/* ── Fixture setup ───────────────────────────────────────────────────────── */

async function setup() {
  /* Active school year — never a literal, the year rolls. */
  const [activeYear] = await db
    .select({ id: schoolYears.id })
    .from(schoolYears)
    .where(eq(schoolYears.status, "active"))
    .limit(1);
  assert.ok(activeYear, "No active school year found");
  const activeYearId = activeYear.id;

  /* An inactive year, created first so its rubric set gets the lower id */
  const [oldYear] = await db
    .insert(schoolYears)
    .values({ name: `TST-TEACHER-OLD-YR-${Date.now()}`, status: "inactive" })
    .returning({ id: schoolYears.id });
  assert.ok(oldYear, "Failed to create old school year");
  createdOldYearId = oldYear.id;

  const [sch] = await db
    .insert(schools)
    .values({
      displayName:  `TST Teacher Yr School ${Date.now()}`,
      fullName:     `TST Teacher Yr School Full ${Date.now()}`,
      abbreviation: `TSTTYR${Date.now() % 10000}`,
      region:       "Boston",
      gradeSpan:    "ES",
      isActive:     true,
      isArchived:   false,
      isHomeOffice: false,
      schoolNumber: "T01",
    })
    .returning({ id: schools.id });
  assert.ok(sch, "Failed to create test school");
  createdSchoolId = sch.id;

  /* Last year's copy of the rubric set — same slug, lower id */
  const [oldRs] = await db
    .insert(rubricSets)
    .values({ slug: SLUG, name: `TST Old RS ${SLUG}`, target: "TEACHER", isActive: false, schoolYearId: createdOldYearId })
    .returning({ id: rubricSets.id });
  assert.ok(oldRs, "Failed to create old rubric set");
  createdOldRubricSetId = oldRs.id;

  /* This year's copy — same slug again, in the active year */
  const [activeRs] = await db
    .insert(rubricSets)
    .values({ slug: SLUG, name: `TST Active RS ${SLUG}`, target: "TEACHER", isActive: true, schoolYearId: activeYearId })
    .returning({ id: rubricSets.id });
  assert.ok(activeRs, "Failed to create active rubric set");
  createdActiveRsId = activeRs.id;

  const leaderEid = `TST_TCH_YR_LEADER_${Date.now()}`;
  createdEids.push(leaderEid);
  await db.insert(people).values({
    employeeId:               leaderEid,
    firstName:                "Teacher",
    lastName:                 "Leader",
    email:                    `${leaderEid}@test.example`,
    role:                     "SCHOOL_LEADER",
    schoolId:                 createdSchoolId,
    isActive:                 true,
    includeInFeedbackTracker: false,
  });

  /* The observed teacher. NO_ACCESS is what almost every teacher is — it
     means "cannot sign in", not "not a person". */
  const teacherEid = `TST_TCH_YR_TEACHER_${Date.now()}`;
  createdEids.push(teacherEid);
  await db.insert(people).values({
    employeeId:               teacherEid,
    firstName:                "Observed",
    lastName:                 "Teacher",
    email:                    `${teacherEid}@test.example`,
    role:                     "NO_ACCESS",
    schoolId:                 createdSchoolId,
    isActive:                 true,
    includeInFeedbackTracker: true,
  });

  /* A published observation this year, against THIS year's rubric set */
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

  await db.insert(observationScores).values({
    observationId: createdObsId,
    domainSlug:    DOMAIN_SLUG,
    score:         1,
  });

  return { leaderEid, teacherEid };
}

/* ── Teardown ────────────────────────────────────────────────────────────── */

async function teardown() {
  if (createdObsId !== null) {
    await db.delete(observationScores).where(eq(observationScores.observationId, createdObsId));
    await db.delete(observations).where(eq(observations.id, createdObsId));
  }
  if (createdEids.length > 0) await db.delete(people).where(inArray(people.employeeId, createdEids));
  if (createdActiveRsId !== null) await db.delete(rubricSets).where(eq(rubricSets.id, createdActiveRsId));
  if (createdOldRubricSetId !== null) await db.delete(rubricSets).where(eq(rubricSets.id, createdOldRubricSetId));
  if (createdSchoolId !== null) await db.delete(schools).where(eq(schools.id, createdSchoolId));
  if (createdOldYearId !== null) await db.delete(schoolYears).where(eq(schoolYears.id, createdOldYearId));
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

type TeacherBody = {
  id: string;
  observations: { id: string; date: string; scores: Record<string, number> }[];
};

describe("GET /teachers/:id — rubric slug resolves to active school year", () => {
  let leaderJar:  Jar;
  let teacherEid: string;

  before(async () => {
    const ids = await setup();
    teacherEid = ids.teacherEid;
    leaderJar  = await loginAs(ids.leaderEid);
  });

  after(teardown);

  test("a teacher observed this year comes back with that observation", async () => {
    const { status, body } = await getJson(
      `/teachers/${encodeURIComponent(teacherEid)}?quarter=${encodeURIComponent(SLUG)}`,
      leaderJar,
    );

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);

    const b = body as TeacherBody;
    assert.equal(
      b.observations.length, 1,
      "Teacher has one published observation against the active year's rubric set, " +
      "but the route returned none — the slug resolved to the old year's copy.",
    );
    assert.equal(
      b.observations[0]!.scores[DOMAIN_SLUG], 1,
      "The observation's score should come back with it",
    );
  });

  test("the two rubric sets are ordered so an unfiltered lookup picks the wrong one", () => {
    assert.ok(createdOldRubricSetId !== null && createdActiveRsId !== null, "rubric set ids must be set");
    assert.ok(
      createdOldRubricSetId < createdActiveRsId,
      `Old rubric set (id=${createdOldRubricSetId}) must have a lower id than active ` +
      `(id=${createdActiveRsId}) — otherwise this fixture would pass even without the year filter`,
    );
  });
});
