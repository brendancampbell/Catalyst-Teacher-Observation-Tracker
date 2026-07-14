/**
 * Integration tests confirming SCHOOL_LEADER cross-school edit protection on
 * PATCH /api/people/:employeeId.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/test-patch-people-school-leader-auth.ts
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. SCHOOL_LEADER PATCHes a person from another school → 403
 *   2. SCHOOL_LEADER PATCHes a person from their own school → 200
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { asc, eq, inArray } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

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

async function apiPatch(
  path: string,
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Cookie": jar.cookieHeader,
    },
    body: JSON.stringify(body),
  });
  let responseBody: unknown;
  try { responseBody = await res.json(); } catch { responseBody = null; }
  return { status: res.status, body: responseBody };
}

/* ── Cleanup tracking ─────────────────────────────────────────────────────── */

const testEmployeeIds: string[] = [];

function makeId(prefix: string): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("PATCH /api/people/:employeeId — SCHOOL_LEADER cross-school protection", () => {
  let schoolAId: number;
  let schoolBId: number;
  let leaderAEid: string;
  let personInSchoolAEid: string;
  let personInSchoolBEid: string;
  let leaderJar: Jar;

  before(async () => {
    /* Resolve two distinct non-home-office school IDs from the live DB */
    const twoSchools = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, false))
      .orderBy(asc(schools.id))
      .limit(2);
    assert.equal(twoSchools.length >= 2, true, "Need at least 2 non-home-office schools in the DB");
    schoolAId = twoSchools[0]!.id;
    schoolBId = twoSchools[1]!.id;

    leaderAEid       = makeId("TST_SL_AUTH_L");
    personInSchoolAEid = makeId("TST_SL_AUTH_A");
    personInSchoolBEid = makeId("TST_SL_AUTH_B");

    testEmployeeIds.push(leaderAEid, personInSchoolAEid, personInSchoolBEid);

    const ts = Date.now();

    /* Create a temporary SCHOOL_LEADER at school A */
    await db.insert(people).values({
      employeeId:               leaderAEid,
      firstName:                "Test",
      lastName:                 `LeaderA${ts}`,
      email:                    `test.leader.a.${ts}@example.com`,
      role:                     "SCHOOL_LEADER",
      schoolId:                 schoolAId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });

    /* Create a COACH at school A (the leader's own school) */
    await db.insert(people).values({
      employeeId:               personInSchoolAEid,
      firstName:                "Test",
      lastName:                 `CoachA${ts}`,
      email:                    `test.coach.a.${ts}@example.com`,
      role:                     "COACH",
      schoolId:                 schoolAId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });

    /* Create a COACH at school B (a different school) */
    await db.insert(people).values({
      employeeId:               personInSchoolBEid,
      firstName:                "Test",
      lastName:                 `CoachB${ts}`,
      email:                    `test.coach.b.${ts}@example.com`,
      role:                     "COACH",
      schoolId:                 schoolBId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });

    leaderJar = await loginAs(leaderAEid);
  });

  after(async () => {
    if (testEmployeeIds.length > 0) {
      await db.delete(people).where(inArray(people.employeeId, testEmployeeIds));
    }
  });

  /* 1 ── SCHOOL_LEADER edits person from another school → 403 ──────────── */

  test("1 — SCHOOL_LEADER PATCHes a person from another school → 403", async () => {
    const res = await apiPatch(
      `/people/${personInSchoolBEid}`,
      { firstName: "Hacked" },
      leaderJar,
    );

    assert.equal(
      res.status,
      403,
      `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const body = res.body as { error?: string };
    assert.ok(
      body.error?.toLowerCase().includes("another school"),
      `error should mention "another school". Got: "${body.error}"`,
    );
  });

  /* 2 ── SCHOOL_LEADER edits person from their own school → 200 ─────────── */

  test("2 — SCHOOL_LEADER PATCHes a person from their own school → 200", async () => {
    const res = await apiPatch(
      `/people/${personInSchoolAEid}`,
      { firstName: "Updated" },
      leaderJar,
    );

    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
