/**
 * Integration tests: observation-count guard on DELETE /api/rubric/sets/:slug
 *
 * Scenarios:
 *   1. Deleting a rubric set with NO observations → 204
 *   2. Deleting a rubric set WITH observations (no ?force) → 409 + observationCount
 *   3. Deleting a rubric set WITH observations + ?force=true → 204
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:rubric-set-deletion-guard
 *
 * Requires the dev server to be running (NODE_ENV=development).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import {
  people,
  schools,
  schoolYears,
  rubricSets,
  rubricCategories,
  observations,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* Resolved from DB in before() — matches what getActiveSchoolYearId() returns */
let SCHOOL_YEAR_ID = 1;

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
let createdObsIds:   number[]      = [];

async function cleanup() {
  if (createdObsIds.length > 0) {
    await db.delete(observations).where(inArray(observations.id, createdObsIds));
    createdObsIds = [];
  }
  if (createdSetIds.length > 0) {
    await db.delete(rubricSets).where(inArray(rubricSets.id, createdSetIds));
    createdSetIds = [];
  }
  if (adminEmployeeId) {
    await db.delete(people).where(eq(people.employeeId, adminEmployeeId));
    adminEmployeeId = null;
  }
}

/* ── Suite ────────────────────────────────────────────────────────────────── */

describe("DELETE /api/rubric/sets/:slug — observation-count guard", () => {
  let jar: Jar;

  let emptySetSlug:   string;
  let guardedSetSlug: string;
  let forcedSetSlug:  string;

  before(async () => {
    /* 1 ── Resolve active school year (must match what getActiveSchoolYearId() returns) */
    const [activeYear] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);
    assert.ok(activeYear, "An active school year must exist");
    SCHOOL_YEAR_ID = activeYear.id;

    /* ── Find Home Office school + any school + any teacher ────────────── */
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
    adminEmployeeId = `TRSDG${ts}`;
    await db.insert(people).values({
      employeeId:               adminEmployeeId,
      firstName:                "Test",
      lastName:                 `RSDG${ts}`,
      email:                    `test.rsdg.${ts}@example.com`,
      role:                     "NETWORK_ADMIN",
      schoolId:                 hoSchool.id,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    jar = await loginAs(adminEmployeeId);

    /* 3 ── Three rubric sets (one per scenario) ───────────────────────────── */
    emptySetSlug   = `rsdg-empty-${ts}`;
    guardedSetSlug = `rsdg-guard-${ts}`;
    forcedSetSlug  = `rsdg-force-${ts}`;

    const sets = await db.insert(rubricSets).values([
      { name: `RSDG Empty ${ts}`,   slug: emptySetSlug,   displayOrder: 9993, schoolYearId: SCHOOL_YEAR_ID, target: "TEACHER" },
      { name: `RSDG Guarded ${ts}`, slug: guardedSetSlug, displayOrder: 9994, schoolYearId: SCHOOL_YEAR_ID, target: "TEACHER" },
      { name: `RSDG Forced ${ts}`,  slug: forcedSetSlug,  displayOrder: 9995, schoolYearId: SCHOOL_YEAR_ID, target: "TEACHER" },
    ]).returning({ id: rubricSets.id });
    createdSetIds = sets.map((r) => r.id);
    const [, guardedSetId, forcedSetId] = createdSetIds;

    /* 4 ── One category per set (so sets are non-trivially populated) ─────── */
    await db.insert(rubricCategories).values([
      { rubricSetId: guardedSetId, name: `Guarded Cat ${ts}`, displayOrder: 1 },
      { rubricSetId: forcedSetId,  name: `Forced Cat ${ts}`,  displayOrder: 1 },
    ]);

    /* 5 ── Observations referencing the guarded and forced sets ──────────── */
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
  });

  after(cleanup);

  /* ── Test 1: empty rubric set deletes cleanly ────────────────────────────── */
  test("1 — rubric set with no observations deletes with 204", async () => {
    const { status } = await apiDelete(`/rubric/sets/${emptySetSlug}`, jar);
    assert.equal(status, 204);
    createdSetIds = createdSetIds.filter((_, i) => i !== 0);
  });

  /* ── Test 2: rubric set with observations blocked at 409 ─────────────────── */
  test("2 — rubric set with observations returns 409 and observationCount without ?force", async () => {
    const { status, body } = await apiDelete(`/rubric/sets/${guardedSetSlug}`, jar);
    assert.equal(status, 409, `Expected 409, got ${status}: ${JSON.stringify(body)}`);
    const b = body as { error?: string; observationCount?: number };
    assert.equal(typeof b.observationCount, "number", "Response must include a numeric observationCount");
    assert.equal(b.observationCount, 1, "observationCount should equal the number of observations inserted");
    assert.ok(
      b.error?.includes("observation"),
      `error message should mention "observation", got: ${b.error}`,
    );
  });

  /* ── Test 3: force=true bypasses the guard ───────────────────────────────── */
  test("3 — rubric set with observations deletes with 204 when ?force=true", async () => {
    const { status } = await apiDelete(`/rubric/sets/${forcedSetSlug}?force=true`, jar);
    assert.equal(status, 204, `Expected 204 with force=true`);
    createdSetIds = createdSetIds.filter((_, i) => i !== 2);
    createdObsIds = createdObsIds.filter((_, i) => i !== 1);
  });
});
