/**
 * Integration tests: score-count guard on DELETE /api/rubric/categories/:id
 *
 * Scenarios:
 *   1. Deleting a category with NO observation scores → 204
 *   2. Deleting a category WITH observation scores (no ?force) → 409 + scoreCount
 *   3. Deleting a category WITH observation scores + ?force=true → 204
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:category-deletion-guard
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
    createdSetIds  = [];
    createdCatIds  = [];
    createdDomIds  = [];
  }
  if (adminEmployeeId) {
    await db.delete(people).where(eq(people.employeeId, adminEmployeeId));
    adminEmployeeId = null;
  }
}

/* ── Suite ────────────────────────────────────────────────────────────────── */

describe("DELETE /api/rubric/categories/:id — score-count guard", () => {
  let jar: Jar;

  let emptyCatId:   number;
  let guardedCatId: number;
  let forcedCatId:  number;

  const guardedSlug = `guard-dom-${ts}`;
  const forcedSlug  = `force-dom-${ts}`;

  before(async () => {
    /* 1 ── Find Home Office school + any teacher ──────────────────────────── */
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
    adminEmployeeId = `TCDG${ts}`;
    await db.insert(people).values({
      employeeId:               adminEmployeeId,
      firstName:                "Test",
      lastName:                 `CDG${ts}`,
      email:                    `test.cdg.${ts}@example.com`,
      role:                     "NETWORK_ADMIN",
      schoolId:                 hoSchool.id,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    jar = await loginAs(adminEmployeeId);

    /* 3 ── Three rubric sets (one per scenario) ───────────────────────────── */
    const sets = await db.insert(rubricSets).values([
      { name: `CDG Empty ${ts}`,   slug: `cdg-empty-${ts}`,   displayOrder: 9990, schoolYearId: SCHOOL_YEAR_ID, target: "TEACHER" },
      { name: `CDG Guarded ${ts}`, slug: `cdg-guarded-${ts}`, displayOrder: 9991, schoolYearId: SCHOOL_YEAR_ID, target: "TEACHER" },
      { name: `CDG Forced ${ts}`,  slug: `cdg-forced-${ts}`,  displayOrder: 9992, schoolYearId: SCHOOL_YEAR_ID, target: "TEACHER" },
    ]).returning({ id: rubricSets.id });
    createdSetIds = sets.map((r) => r.id);
    const [emptySetId, guardedSetId, forcedSetId] = createdSetIds;

    /* 4 ── One category per set ───────────────────────────────────────────── */
    const cats = await db.insert(rubricCategories).values([
      { rubricSetId: emptySetId,   name: `Empty Cat ${ts}`,   displayOrder: 1 },
      { rubricSetId: guardedSetId, name: `Guarded Cat ${ts}`, displayOrder: 1 },
      { rubricSetId: forcedSetId,  name: `Forced Cat ${ts}`,  displayOrder: 1 },
    ]).returning({ id: rubricCategories.id });
    createdCatIds = cats.map((r) => r.id);
    [emptyCatId, guardedCatId, forcedCatId] = createdCatIds;

    /* 5 ── Domains for the guarded and forced categories ─────────────────── */
    const doms = await db.insert(rubricDomains).values([
      {
        categoryId:   guardedCatId,
        rubricSetId:  guardedSetId,
        schoolYearId: SCHOOL_YEAR_ID,
        name:         "Guarded Domain",
        slug:         guardedSlug,
        displayOrder: 1,
      },
      {
        categoryId:   forcedCatId,
        rubricSetId:  forcedSetId,
        schoolYearId: SCHOOL_YEAR_ID,
        name:         "Forced Domain",
        slug:         forcedSlug,
        displayOrder: 1,
      },
    ]).returning({ id: rubricDomains.id });
    createdDomIds = doms.map((r) => r.id);

    /* 6 ── Observations + scores referencing each domain ─────────────────── */
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

  /* ── Test 1: empty category deletes cleanly ─────────────────────────────── */
  test("1 — category with no scores deletes with 204", async () => {
    const { status } = await apiDelete(`/rubric/categories/${emptyCatId}`, jar);
    assert.equal(status, 204);
    createdCatIds = createdCatIds.filter((id) => id !== emptyCatId);
  });

  /* ── Test 2: category with scores blocked at 409 ────────────────────────── */
  test("2 — category with scores returns 409 and scoreCount without ?force", async () => {
    const { status, body } = await apiDelete(`/rubric/categories/${guardedCatId}`, jar);
    assert.equal(status, 409, `Expected 409, got ${status}: ${JSON.stringify(body)}`);
    const b = body as { error?: string; scoreCount?: number };
    assert.equal(typeof b.scoreCount, "number", "Response must include a numeric scoreCount");
    assert.equal(b.scoreCount, 1, "scoreCount should equal the number of scores inserted");
    assert.ok(
      b.error?.includes("observation score"),
      `error message should mention "observation scores", got: ${b.error}`,
    );
  });

  /* ── Test 3: force=true bypasses the guard ──────────────────────────────── */
  test("3 — category with scores deletes with 204 when ?force=true", async () => {
    const { status } = await apiDelete(`/rubric/categories/${forcedCatId}?force=true`, jar);
    assert.equal(status, 204, `Expected 204 with force=true`);
    createdCatIds = createdCatIds.filter((id) => id !== forcedCatId);
  });
});
