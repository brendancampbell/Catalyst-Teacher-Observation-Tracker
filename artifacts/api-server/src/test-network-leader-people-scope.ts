/**
 * Integration tests: NETWORK_LEADER schoolId scoping on GET /api/people.
 *
 * Network Leaders have organisation-wide visibility: omitting ?schoolId=
 * lists people across every school (this is what the Admin → Users tab
 * relies on), and passing ?schoolId= narrows the list to that one school
 * (what school-specific screens rely on). These tests assert both branches.
 *
 * Supersedes the earlier Task #502 rule, which returned 403 when schoolId
 * was omitted and broke the Admin → Users tab for Network Leaders.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:network-leader-people-scope
 *
 * Requires the dev server to be running (NODE_ENV=development).
 *
 * Scenarios:
 *   1. NETWORK_LEADER calls GET /people with no schoolId → 200, sees people
 *      from BOTH schools
 *   2. NETWORK_LEADER calls GET /people?schoolId=<A> → 200, sees only school A
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, and } from "drizzle-orm";
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
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  assert.ok(setCookie, "dev-login should return a Set-Cookie header");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

async function apiGet(
  path: string,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Cookie": jar.cookieHeader },
  });
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/* ── Cleanup registry ─────────────────────────────────────────────────────── */

let testEmployeeIds: string[] = [];

function makeId(prefix = "TNLPS"): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 100_000)}`;
}

async function cleanup() {
  if (testEmployeeIds.length > 0) {
    await db.delete(people).where(inArray(people.employeeId, testEmployeeIds));
    testEmployeeIds = [];
  }
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("GET /api/people — NETWORK_LEADER schoolId scoping", () => {
  let nlJar:    Jar;
  let schoolAId: number;
  let schoolBId: number;
  let personAId: string;
  let personBId: string;

  before(async () => {
    /* Locate two distinct real (non-Home-Office, active, non-archived) schools */
    const realRows = await db
      .select({ id: schools.id })
      .from(schools)
      .where(and(eq(schools.isHomeOffice, false), eq(schools.isActive, true), eq(schools.isArchived, false)))
      .limit(2);
    assert.equal(realRows.length, 2, "At least two real schools must exist in the DB");
    schoolAId = realRows[0]!.id;
    schoolBId = realRows[1]!.id;

    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);

    /* Create a NETWORK_LEADER (schoolId null — matches session-expiry test pattern) */
    const nlId = makeId("TNLPS_NL");
    await db.insert(people).values({
      employeeId:               nlId,
      firstName:                "Test",
      lastName:                 `NL${ts}`,
      email:                    `test.nl.${ts}@example.com`,
      role:                     "NETWORK_LEADER",
      schoolId:                 null,
      isActive:                 true,
      includeInFeedbackTracker: false,
    });
    testEmployeeIds.push(nlId);

    /* One person in each school, so cross-school visibility is observable */
    personAId = makeId("TNLPS_A");
    personBId = makeId("TNLPS_B");
    await db.insert(people).values([
      {
        employeeId:               personAId,
        firstName:                "Test",
        lastName:                 `PersonA${ts}`,
        email:                    `test.person.a.${ts}@example.com`,
        role:                     "COACH",
        schoolId:                 schoolAId,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               personBId,
        firstName:                "Test",
        lastName:                 `PersonB${ts}`,
        email:                    `test.person.b.${ts}@example.com`,
        role:                     "COACH",
        schoolId:                 schoolBId,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
    ]);
    testEmployeeIds.push(personAId, personBId);

    nlJar = await loginAs(nlId);
  });

  after(cleanup);

  /* 1 ── No schoolId → 200, people from every school ───────────────────── */

  test("1 — NETWORK_LEADER GET /people without schoolId → 200, sees all schools", async () => {
    const { status, body } = await apiGet("/people", nlJar);

    assert.equal(
      status,
      200,
      `Expected 200, got ${status}: ${JSON.stringify(body)}`,
    );
    assert.ok(Array.isArray(body), "Response body should be an array of people");

    const ids = new Set((body as Array<{ employeeId: string }>).map((p) => p.employeeId));
    assert.ok(ids.has(personAId), "Unscoped list should include the person in school A");
    assert.ok(ids.has(personBId), "Unscoped list should include the person in school B");
  });

  /* 2 ── Valid schoolId → 200, narrowed to that school ─────────────────── */

  test("2 — NETWORK_LEADER GET /people?schoolId=<A> → 200, only school A", async () => {
    const { status, body } = await apiGet(`/people?schoolId=${schoolAId}`, nlJar);

    assert.equal(
      status,
      200,
      `Expected 200, got ${status}: ${JSON.stringify(body)}`,
    );
    assert.ok(Array.isArray(body), "Response body should be an array of people");

    const ids = new Set((body as Array<{ employeeId: string }>).map((p) => p.employeeId));
    assert.ok(ids.has(personAId),  "Scoped list should include the person in school A");
    assert.ok(!ids.has(personBId), "Scoped list should NOT include the person in school B");
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
