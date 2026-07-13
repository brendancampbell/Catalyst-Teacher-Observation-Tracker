/**
 * Integration tests — COACH role is blocked from admin-only endpoints.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:coach-admin-block
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * Scenarios:
 *   1.  COACH → GET  /people                               → 200  (shared endpoint, allowed)
 *   2.  COACH → GET  /people?includeInactive=true          → 403  (admin-only flag)
 *   3.  COACH → POST /people                               → 403
 *   4.  COACH → POST /people/bulk                          → 403
 *   5.  COACH → PATCH /people/:id                          → 403
 *   6.  COACH → PATCH /people/:id/toggle-active            → 403
 *   7.  COACH → GET  /admin/schools                        → 403
 *   8.  COACH → GET  /rubric/sets                          → 200  (shared endpoint, allowed)
 *   9.  COACH → GET  /rubric/sets?includeArchived=true     → 403  (admin-only flag)
 *  10.  COACH → POST /rubric/sets                          → 403
 *  11.  COACH → PUT  /rubric/sets/reorder                  → 403
 *  12.  COACH → PATCH /rubric/sets/:slug                   → 403
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── Test entity IDs ──────────────────────────────────────────────────────── */

const COACH_EID   = "TST_COACH_ADMINBLK_COACH";
const ADMIN_EID   = "TST_COACH_ADMINBLK_ADMIN";

const ALL_EIDS = [COACH_EID, ADMIN_EID];

let SCHOOL_ID: number;

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function request(
  method: string,
  path: string,
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown; jar: Jar }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar.cookieHeader) headers["Cookie"] = jar.cookieHeader;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.get("set-cookie");
  const updatedJar: Jar = setCookie
    ? { cookieHeader: setCookie.split(";")[0] ?? jar.cookieHeader }
    : jar;

  let responseBody: unknown;
  try { responseBody = await res.json(); } catch { responseBody = null; }
  return { status: res.status, body: responseBody, jar: updatedJar };
}

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  const setCookie = res.headers.get("set-cookie");
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  assert.ok(setCookie, "dev-login should return Set-Cookie");
  return { cookieHeader: setCookie!.split(";")[0]! };
}

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

describe("COACH role is blocked from admin-only endpoints", () => {
  before(async () => {
    const [school] = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(1);
    assert.ok(school, "Need at least one school in the DB");
    SCHOOL_ID = school.id;

    await db.insert(people).values([
      {
        employeeId:               COACH_EID,
        firstName:                "Test",
        lastName:                 "CoachAdminBlk",
        email:                    "tst.coach.adminblk.coach@example.com",
        role:                     "COACH",
        schoolId:                 SCHOOL_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               ADMIN_EID,
        firstName:                "Test",
        lastName:                 "CoachAdminBlkAdmin",
        email:                    "tst.coach.adminblk.admin@example.com",
        role:                     "NETWORK_ADMIN",
        schoolId:                 null,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
    ]).onConflictDoNothing();
  });

  after(async () => {
    await db.delete(people)
      .where(inArray(people.employeeId, ALL_EIDS));
  });

  /* ── /api/people ──────────────────────────────────────────────────────── */

  test("1 — COACH GET /people (no flags) returns 200", async () => {
    const jar = await loginAs(COACH_EID);
    const res = await request("GET", "/people", undefined, jar);
    assert.equal(res.status, 200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("2 — COACH GET /people?includeInactive=true returns 403", async () => {
    const jar = await loginAs(COACH_EID);
    const res = await request("GET", "/people?includeInactive=true", undefined, jar);
    assert.equal(res.status, 403,
      `Expected 403 for includeInactive, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("3 — COACH POST /people returns 403", async () => {
    const jar = await loginAs(COACH_EID);
    const res = await request("POST", "/people", {
      employeeId: "TST_COACH_ADMINBLK_GHOST",
      firstName: "Ghost",
      lastName: "User",
      email: "ghost.adminblk@example.com",
      role: "COACH",
      schoolId: SCHOOL_ID,
    }, jar);
    assert.equal(res.status, 403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("4 — COACH POST /people/bulk returns 403", async () => {
    const jar = await loginAs(COACH_EID);
    const res = await request("POST", "/people/bulk", [
      {
        employeeId: "TST_BULK_BLK",
        firstName: "Bulk",
        lastName: "Blocked",
        email: "bulk.blocked@example.com",
        role: "COACH",
      },
    ], jar);
    assert.equal(res.status, 403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("5 — COACH PATCH /people/:id returns 403", async () => {
    const jar = await loginAs(COACH_EID);
    /* Attempt to edit the admin fixture — COACH should be rejected before
       any person-lookup logic runs.                                        */
    const res = await request("PATCH", `/people/${ADMIN_EID}`, {
      firstName: "Hacked",
    }, jar);
    assert.equal(res.status, 403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("6 — COACH PATCH /people/:id/toggle-active returns 403", async () => {
    const jar = await loginAs(COACH_EID);
    const res = await request("PATCH", `/people/${ADMIN_EID}/toggle-active`, undefined, jar);
    assert.equal(res.status, 403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* ── /api/admin/schools ───────────────────────────────────────────────── */

  test("7 — COACH GET /admin/schools returns 403", async () => {
    const jar = await loginAs(COACH_EID);
    const res = await request("GET", "/admin/schools", undefined, jar);
    assert.equal(res.status, 403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* ── /api/rubric ──────────────────────────────────────────────────────── */

  test("8 — COACH GET /rubric/sets (no flags) returns 200", async () => {
    const jar = await loginAs(COACH_EID);
    const res = await request("GET", "/rubric/sets", undefined, jar);
    assert.equal(res.status, 200,
      `Expected 200 (shared endpoint), got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("9 — COACH GET /rubric/sets?includeArchived=true returns 403", async () => {
    const jar = await loginAs(COACH_EID);
    const res = await request("GET", "/rubric/sets?includeArchived=true", undefined, jar);
    assert.equal(res.status, 403,
      `Expected 403 for includeArchived, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("10 — COACH POST /rubric/sets returns 403", async () => {
    const jar = await loginAs(COACH_EID);
    const res = await request("POST", "/rubric/sets", {
      slug: "TST_COACH_ADMINBLK_SET",
      name: "Blocked Rubric Set",
    }, jar);
    assert.equal(res.status, 403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("11 — COACH PUT /rubric/sets/reorder returns 403", async () => {
    const jar = await loginAs(COACH_EID);
    const res = await request("PUT", "/rubric/sets/reorder", [
      { slug: "SCHOOLWI", displayOrder: 1 },
    ], jar);
    assert.equal(res.status, 403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("12 — COACH PATCH /rubric/sets/:slug returns 403", async () => {
    const jar = await loginAs(COACH_EID);
    const res = await request("PATCH", "/rubric/sets/SCHOOLWI", {
      name: "Hacked Name",
    }, jar);
    assert.equal(res.status, 403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });
});

process.on("exit", () => { /* db pool closed by process exit */ });
