/**
 * Integration tests: score-count guard on DELETE /api/rubric/domains/:id
 *
 * Mirrors test-category-deletion-guard.ts for the domain-level endpoint.
 *
 * Scenarios:
 *   1. Deleting a domain with NO observation scores → 204
 *   2. Deleting a domain WITH observation scores (no ?force) → 409 + scoreCount
 *   3. Deleting a domain WITH observation scores + ?force=true → 204
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:domain-deletion-guard
 *
 * Requires the dev server to be running (NODE_ENV=development).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import {
  people,
  schools,
  rubricSets,
  rubricCategories,
  rubricDomains,
  observations,
  observationScores,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;
const SCHOOL_YEAR_ID = 1;

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "dev-login should return a Set-Cookie header");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

async function apiDelete(
  path: string,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: { Cookie: jar.cookieHeader, origin: "http://localhost:3000" },
  });
  let body: unknown = null;
  if (res.status !== 204) {
    try { body = await res.json(); } catch { /* empty */ }
  }
  return { status: res.status, body };
}

/* ── Test state ───────────────────────────────────────────────────────────── */

const ts = Date.now() + Math.floor(Math.random() * 1_000_000);

let adminEmployeeId: string | null = null;
let createdSetIds:   number[]      = [];
let createdCatIds:   number[]      = [];
let createdDomIds:   number[]      = [];
let createdObsIds:   number[]      = [];

async function cleanup() {
  /* observation_scores cascade-deletes with observations */
  if (createdObsIds.length > 0) {
    await db.delete(observations).where(inArray(observations.id, createdObsIds));
    createdObsIds = [];
  }
  /* domains cascade-delete with categories; categories cascade-delete with sets */
  if (createdSetIds.length > 0) {
    await db.delete(rubricSets).where(inArray(rubricSets.id, createdSetIds));
    createdSetIds = [];
    createdCatIds = [];
    createdDomIds = [];
  }
  if (adminEmployeeId) {
    await db.delete(people).where(eq(people.employeeId, adminEmployeeId));
    adminEmployeeId = null;
  }
}

/* ── Suite ────────────────────────────────────────────────────────────────── */

describe("DELETE /api/rubric/domains/:id — score-count guard", () => {
  let jar: Jar;

  let emptyDomId:   number;
  let guardedDomId: number;
  let forcedDomId:  number;

  const guardedSlug = `ddg-guard-${ts}`;
  const forcedSlug  = `ddg-force-${ts}`;

  before(async () => {
    /* 1 ── Find Home Office school + any school + any teacher ─────────────── */
    const [hoSchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, true))
      .limit(1);
    assert.ok(hoSchool, "Home Office school must exist");

    const [anySchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .limit(1);
    assert.ok(anySchool, "At least one school must exist");

    const [teacher] = await db
      .select({ employeeId: people.employeeId })
      .from(people)
      .where(eq(people.role, "COACH"))
      .limit(1);
    assert.ok(teacher, "At least one COACH must exist in seed data");

    /* 2 ── Create a throw-away NETWORK_ADMIN ─────────────────────────────── */
    adminEmployeeId = `TDDG${ts}`;
    await db.insert(people).values({
      employeeId:               adminEmployeeId,
      firstName:                "Test",
      lastName:                 `DDG${ts}`,
      email:                    `test.ddg.${ts}@example.com`,
      role:                     "NETWORK_ADMIN",
      schoolId:                 hoSchool.id,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    jar = await loginAs(adminEmployeeId);

    /* 3 ── Three rubric sets (one per scenario) ───────────────────────────── */
    const sets = await db.insert(rubricSets).values([
      { name: `DDG Empty ${ts}`,   slug: `ddg-empty-${ts}`,   displayOrder: 9990, schoolYearId: SCHOOL_YEAR_ID, target: "TEACHER" },
      { name: `DDG Guarded ${ts}`, slug: `ddg-guard-s-${ts}`, displayOrder: 9991, schoolYearId: SCHOOL_YEAR_ID, target: "TEACHER" },
      { name: `DDG Forced ${ts}`,  slug: `ddg-force-s-${ts}`, displayOrder: 9992, schoolYearId: SCHOOL_YEAR_ID, target: "TEACHER" },
    ]).returning({ id: rubricSets.id });
    createdSetIds = sets.map((r) => r.id);
    const [emptySetId, guardedSetId, forcedSetId] = createdSetIds;

    /* 4 ── One category per set ───────────────────────────────────────────── */
    const cats = await db.insert(rubricCategories).values([
      { rubricSetId: emptySetId,   name: `DDG Empty Cat ${ts}`,   displayOrder: 1 },
      { rubricSetId: guardedSetId, name: `DDG Guarded Cat ${ts}`, displayOrder: 1 },
      { rubricSetId: forcedSetId,  name: `DDG Forced Cat ${ts}`,  displayOrder: 1 },
    ]).returning({ id: rubricCategories.id });
    createdCatIds = cats.map((r) => r.id);
    const [emptyCatId, guardedCatId, forcedCatId] = createdCatIds;

    /* 5 ── One domain per category ───────────────────────────────────────── */
    const doms = await db.insert(rubricDomains).values([
      {
        categoryId:   emptyCatId,
        rubricSetId:  emptySetId,
        schoolYearId: SCHOOL_YEAR_ID,
        name:         "DDG Empty Domain",
        slug:         `ddg-empty-dom-${ts}`,
        displayOrder: 1,
      },
      {
        categoryId:   guardedCatId,
        rubricSetId:  guardedSetId,
        schoolYearId: SCHOOL_YEAR_ID,
        name:         "DDG Guarded Domain",
        slug:         guardedSlug,
        displayOrder: 1,
      },
      {
        categoryId:   forcedCatId,
        rubricSetId:  forcedSetId,
        schoolYearId: SCHOOL_YEAR_ID,
        name:         "DDG Forced Domain",
        slug:         forcedSlug,
        displayOrder: 1,
      },
    ]).returning({ id: rubricDomains.id });
    createdDomIds = doms.map((r) => r.id);
    [emptyDomId, guardedDomId, forcedDomId] = createdDomIds;

    /* 6 ── Observations + scores referencing the guarded and forced domains ─ */
    const obsRows = await db.insert(observations).values([
      {
        observedEmployeeId:  teacher.employeeId,
        observerEmployeeId:  adminEmployeeId,
        schoolId:            anySchool.id,
        schoolYearId:        SCHOOL_YEAR_ID,
        rubricSetId:         guardedSetId,
        date:                "2025-01-15",
        observer:            "Test Observer",
        status:              "published",
      },
      {
        observedEmployeeId:  teacher.employeeId,
        observerEmployeeId:  adminEmployeeId,
        schoolId:            anySchool.id,
        schoolYearId:        SCHOOL_YEAR_ID,
        rubricSetId:         forcedSetId,
        date:                "2025-01-15",
        observer:            "Test Observer",
        status:              "published",
      },
    ]).returning({ id: observations.id });
    createdObsIds = obsRows.map((r) => r.id);
    const [guardedObsId, forcedObsId] = createdObsIds;

    await db.insert(observationScores).values([
      { observationId: guardedObsId, domainSlug: guardedSlug, score: 0.5 },
      { observationId: forcedObsId,  domainSlug: forcedSlug,  score: 1   },
    ]);
  });

  after(cleanup);

  /* ── Test 1: empty domain deletes cleanly ─────────────────────────────────── */
  test("1 — domain with no scores deletes with 204", async () => {
    const { status } = await apiDelete(`/rubric/domains/${emptyDomId}`, jar);
    assert.equal(status, 204);
    createdDomIds = createdDomIds.filter((id) => id !== emptyDomId);
  });

  /* ── Test 2: domain with scores blocked at 409 ───────────────────────────── */
  test("2 — domain with scores returns 409 and scoreCount without ?force", async () => {
    const { status, body } = await apiDelete(`/rubric/domains/${guardedDomId}`, jar);
    assert.equal(status, 409, `Expected 409, got ${status}: ${JSON.stringify(body)}`);
    const b = body as { error?: string; scoreCount?: number };
    assert.equal(typeof b.scoreCount, "number", "Response must include a numeric scoreCount");
    assert.equal(b.scoreCount, 1, "scoreCount should equal the number of scores inserted");
    assert.ok(
      b.error?.includes("observation score"),
      `error message should mention "observation score", got: ${b.error}`,
    );
  });

  /* ── Test 3: force=true bypasses the guard ───────────────────────────────── */
  test("3 — domain with scores deletes with 204 when ?force=true", async () => {
    const { status } = await apiDelete(`/rubric/domains/${forcedDomId}?force=true`, jar);
    assert.equal(status, 204, `Expected 204 with force=true`);
    createdDomIds = createdDomIds.filter((id) => id !== forcedDomId);
  });
});
