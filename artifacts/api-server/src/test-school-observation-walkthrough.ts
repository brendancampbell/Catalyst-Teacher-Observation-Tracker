/**
 * Integration tests: school-wide observations carry a walkthrough flag and
 * written feedback (backlog #34).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:school-observation-walkthrough
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * The SCHOOL-target insert used to hardcode isWalkthrough to false, so a
 * school-wide observation could never be marked as a walkthrough. strengths
 * and growthAreas were always stored — nothing collected them.
 *
 * On a TEACHER rubric a walkthrough below proficiency puts that teacher in the
 * rescore queue. Here it is deliberately a label and nothing more: the queue
 * flags a person, and a school-wide observation has none. Test 4 is the one
 * that matters — it pins that decision rather than leaving it to be inferred
 * from a null check.
 *
 *   1. A school-wide observation can be marked as a walkthrough
 *   2. Glows and grows are stored on it
 *   3. Leaving the toggle off still stores false
 *   4. A below-proficiency school walkthrough flags NOBODY for rescore
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

const STAMP     = Date.now();
const ADMIN_EID = "U10";
const BELOW = 0.5;   /* under the 0.7 proficiency threshold */
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

let adminJar: Jar;
let schoolId: number;
let yearId:   number;
let rubricSetId: number;
let domainSlug:  string;
const createdObsIds: number[] = [];

describe("School-wide observations: walkthrough flag and written feedback", () => {
  before(async () => {
    const [school] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(1);
    assert.ok(school, "Need a school");
    schoolId = school.id;

    const [year] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");
    yearId = year.id;

    /* A SCHOOL-target rubric with one domain, so the mean is the value set. */
    const [rs] = await db.insert(rubricSets)
      .values({ slug: `tst-swo-rs-${STAMP}`, name: "School Walkthrough RS",
                target: "SCHOOL", isActive: true, schoolYearId: yearId })
      .returning({ id: rubricSets.id });
    assert.ok(rs);
    rubricSetId = rs.id;

    const [cat] = await db.insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "SWO Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat);

    const [dom] = await db.insert(rubricDomains)
      .values({ categoryId: cat.id, rubricSetId: rs.id, schoolYearId: yearId,
                slug: `tst-swo-dom-${STAMP}`, name: "SWO Domain", displayOrder: 1 })
      .returning({ slug: rubricDomains.slug });
    assert.ok(dom);
    domainSlug = dom.slug;

    adminJar = await loginAs(ADMIN_EID);
  });

  after(async () => {
    if (createdObsIds.length > 0) {
      await db.delete(observations).where(inArray(observations.id, createdObsIds)).catch(() => {});
    }
    await db.delete(rubricSets).where(eq(rubricSets.id, rubricSetId)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — a school-wide observation can be marked as a walkthrough", async () => {
    const res = await request("POST", "/observations", {
      target: "SCHOOL", schoolId, rubricSetId, date: "2026-09-15",
      scores: { [domainSlug]: ABOVE },
      isWalkthrough: true, status: "published",
    }, adminJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
    createdObsIds.push(Number(res.body.id));

    const [row] = await db.select({ isWalkthrough: observations.isWalkthrough, target: observations.target })
      .from(observations).where(eq(observations.id, Number(res.body.id))).limit(1);
    assert.equal(row!.target, "SCHOOL");
    assert.equal(row!.isWalkthrough, true, "the flag used to be hardcoded false here");
  });

  test("2 — glows and grows are stored on it", async () => {
    const res = await request("POST", "/observations", {
      target: "SCHOOL", schoolId, rubricSetId, date: "2026-09-16",
      scores: { [domainSlug]: ABOVE },
      strengths:   "<p>Calm hallways, strong routines</p>",
      growthAreas: "<p>Arrival could be tighter</p>",
      isWalkthrough: true, status: "published",
    }, adminJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
    createdObsIds.push(Number(res.body.id));

    const [row] = await db.select({
      strengths:   observations.strengths,
      growthAreas: observations.growthAreas,
    }).from(observations).where(eq(observations.id, Number(res.body.id))).limit(1);
    assert.match(String(row!.strengths),   /Calm hallways/);
    assert.match(String(row!.growthAreas), /Arrival could be tighter/);
  });

  test("3 — leaving the toggle off still stores false", async () => {
    const res = await request("POST", "/observations", {
      target: "SCHOOL", schoolId, rubricSetId, date: "2026-09-17",
      scores: { [domainSlug]: ABOVE }, status: "published",
    }, adminJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
    createdObsIds.push(Number(res.body.id));

    const [row] = await db.select({ isWalkthrough: observations.isWalkthrough })
      .from(observations).where(eq(observations.id, Number(res.body.id))).limit(1);
    assert.equal(row!.isWalkthrough, false);
  });

  test("4 — a below-proficiency school walkthrough flags NOBODY for rescore", async () => {
    /* The decision, pinned. A school-wide walkthrough is a label: it does not
       put anybody in the rescore queue, and there is no school-level
       equivalent. If a school rescore queue is ever built, this test should
       fail and be rewritten deliberately — not quietly start passing for a
       different reason. */
    const before = await db.select({ employeeId: people.employeeId })
      .from(people).where(eq(people.needsRescore, true));

    const res = await request("POST", "/observations", {
      target: "SCHOOL", schoolId, rubricSetId, date: "2026-09-18",
      scores: { [domainSlug]: BELOW },
      isWalkthrough: true, status: "published",
    }, adminJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
    createdObsIds.push(Number(res.body.id));

    const after = await db.select({ employeeId: people.employeeId })
      .from(people).where(eq(people.needsRescore, true));
    assert.equal(after.length, before.length,
      "a school-wide walkthrough must not change who is queued for a rescore");

    /* And the row itself holds no teacher, which is why it cannot. */
    const [row] = await db.select({ observed: observations.observedEmployeeId })
      .from(observations).where(eq(observations.id, Number(res.body.id))).limit(1);
    assert.equal(row!.observed, null);
  });
});
