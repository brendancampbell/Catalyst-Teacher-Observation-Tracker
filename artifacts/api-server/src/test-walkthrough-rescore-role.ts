/**
 * Integration tests: any role's walkthrough can trigger a rescore.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:walkthrough-rescore
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * The rescore queue used to depend on WHO did the walkthrough. Both the create
 * and publish paths gated the flag on NETWORK_ADMIN / NETWORK_LEADER /
 * SCHOOL_LEADER, so a COACH's walkthrough never flagged anybody — and coaches
 * can mark a walkthrough from the dashboard and from a teacher profile, so
 * those below-proficiency walkthroughs simply vanished from the queue.
 *
 * Whether a teacher needs rescoring is a fact about the scores, not about the
 * observer's job title.
 *
 *   1. A coach's below-proficiency walkthrough flags the teacher
 *   2. A coach's at-proficiency walkthrough clears the flag
 *   3. The same holds when a coach publishes a draft (the PUT path)
 *   4. A coach's ordinary observation still flags nobody
 *   5. A school leader's walkthrough still works (no regression)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  people, schools, schoolYears, observations,
  rubricSets, rubricCategories, rubricDomains,
} from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP    = Date.now();
const COACH    = `TST_WTR_COACH_${STAMP}`;
const LEADER   = `TST_WTR_SL_${STAMP}`;
const TEACHER  = `TST_WTR_TCH_${STAMP}`;
const ALL_EIDS = [COACH, LEADER, TEACHER];

/* 0.5 is below the 0.7 proficiency threshold; 1.0 is above it. */
const BELOW = 0.5;
const ABOVE = 1.0;

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

async function rescoreState() {
  const [p] = await db
    .select({ needsRescore: people.needsRescore, dueDate: people.rescoreDueDate })
    .from(people).where(eq(people.employeeId, TEACHER)).limit(1);
  return p!;
}

async function clearFlag() {
  await db.update(people)
    .set({ needsRescore: false, rescoreDueDate: null, rescoreSchoolYearId: null })
    .where(eq(people.employeeId, TEACHER));
}

let coachJar:  Jar;
let leaderJar: Jar;
let schoolId:  number;
let yearId:    number;
let rubricSetId: number;
let domainSlug:  string;
let rubricSetIdCreated: number | null = null;

describe("Walkthrough rescore is not gated on the observer's role", () => {
  before(async () => {
    const [school] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(1);
    assert.ok(school, "Need a school");
    schoolId = school.id;

    const [year] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");
    yearId = year.id;

    /* A dedicated TEACHER-target rubric with one domain, so the mean score is
       exactly the one value each test sets. */
    const [rs] = await db.insert(rubricSets)
      .values({ slug: `tst-wtr-rs-${STAMP}`, name: "Walkthrough Rescore RS",
                target: "TEACHER", isActive: true, schoolYearId: yearId })
      .returning({ id: rubricSets.id });
    assert.ok(rs);
    rubricSetId = rs.id;
    rubricSetIdCreated = rs.id;

    const [cat] = await db.insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "WTR Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat);

    const [dom] = await db.insert(rubricDomains)
      .values({ categoryId: cat.id, rubricSetId: rs.id, schoolYearId: yearId,
                slug: `tst-wtr-dom-${STAMP}`, name: "WTR Domain", displayOrder: 1 })
      .returning({ slug: rubricDomains.slug });
    assert.ok(dom);
    domainSlug = dom.slug;

    await db.insert(people).values([
      { employeeId: COACH, firstName: "Wtr", lastName: "Coach", email: `${COACH}@example.com`.toLowerCase(),
        role: "COACH", schoolId, isActive: true, includeInFeedbackTracker: false },
      { employeeId: LEADER, firstName: "Wtr", lastName: "Leader", email: `${LEADER}@example.com`.toLowerCase(),
        role: "SCHOOL_LEADER", schoolId, isActive: true, includeInFeedbackTracker: false },
      { employeeId: TEACHER, firstName: "Wtr", lastName: "Teacher", email: `${TEACHER}@example.com`.toLowerCase(),
        role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true },
    ]).onConflictDoNothing();

    coachJar  = await loginAs(COACH);
    leaderJar = await loginAs(LEADER);
  });

  after(async () => {
    await db.delete(observations).where(eq(observations.observedEmployeeId, TEACHER)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    if (rubricSetIdCreated !== null) {
      await db.delete(rubricSets).where(eq(rubricSets.id, rubricSetIdCreated)).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  test("1 — a coach's below-proficiency walkthrough flags the teacher", async () => {
    await clearFlag();
    const res = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-09-14",
      scores: { [domainSlug]: BELOW },
      strengths: "s", growthAreas: "g", isWalkthrough: true, status: "published",
    }, coachJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));

    const state = await rescoreState();
    assert.equal(state.needsRescore, true,
      "a coach's walkthrough below proficiency must put the teacher in the rescore queue");
    assert.ok(state.dueDate, "a rescore due date should be set");
  });

  test("2 — a coach's at-proficiency walkthrough clears the flag", async () => {
    const res = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-09-21",
      scores: { [domainSlug]: ABOVE },
      strengths: "s", growthAreas: "g", isWalkthrough: true, status: "published",
    }, coachJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));

    const state = await rescoreState();
    assert.equal(state.needsRescore, false, "scoring at or above proficiency should clear the queue entry");
    assert.equal(state.dueDate, null);
  });

  test("3 — the same holds when a coach publishes a draft", async () => {
    await clearFlag();
    const draft = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-09-28",
      scores: { [domainSlug]: BELOW },
      strengths: "s", growthAreas: "g", isWalkthrough: true, status: "draft",
    }, coachJar);
    assert.ok(draft.status === 200 || draft.status === 201, JSON.stringify(draft.body));

    /* A draft must not flag anybody — nothing is decided until it is published. */
    assert.equal((await rescoreState()).needsRescore, false, "a draft should not flag anybody");

    const pub = await request("PUT", `/observations/${draft.body.id}`, {
      status: "published", scores: { [domainSlug]: BELOW },
    }, coachJar);
    assert.equal(pub.status, 200, JSON.stringify(pub.body));

    assert.equal((await rescoreState()).needsRescore, true,
      "publishing a coach's below-proficiency walkthrough must flag the teacher");
  });

  test("4 — a coach's ordinary observation still flags nobody", async () => {
    await clearFlag();
    const res = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-10-05",
      scores: { [domainSlug]: BELOW },
      strengths: "s", growthAreas: "g", isWalkthrough: false, status: "published",
    }, coachJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));

    assert.equal((await rescoreState()).needsRescore, false,
      "only walkthroughs drive the rescore queue — this rule has not changed");
  });

  test("5 — a school leader's walkthrough still works", async () => {
    await clearFlag();
    const res = await request("POST", "/observations", {
      teacherId: TEACHER, rubricSetId, date: "2026-10-12",
      scores: { [domainSlug]: BELOW },
      strengths: "s", growthAreas: "g", isWalkthrough: true, status: "published",
    }, leaderJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));

    assert.equal((await rescoreState()).needsRescore, true,
      "the roles that already worked must keep working");
  });
});
