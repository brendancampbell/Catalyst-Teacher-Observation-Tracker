/**
 * Integration tests: NETWORK_LEADER schoolId enforcement on GET /api/people.
 *
 * Task #502 added a rule: NETWORK_LEADER must supply ?schoolId= when calling
 * GET /api/people — omitting it returns 403. These tests assert both branches
 * so the guard cannot be accidentally removed without CI catching it.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:network-leader-people-scope
 *
 * Requires the dev server to be running (NODE_ENV=development).
 *
 * Scenarios:
 *   1. NETWORK_LEADER calls GET /people with no schoolId  → 403
 *   2. NETWORK_LEADER calls GET /people with valid schoolId → 200
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

describe("GET /api/people — NETWORK_LEADER schoolId scope enforcement", () => {
  let nlJar:       Jar;
  let realSchoolId: number;

  before(async () => {
    /* Locate a real (non-Home-Office, active, non-archived) school for the schoolId param */
    const [realRow] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(and(eq(schools.isHomeOffice, false), eq(schools.isActive, true), eq(schools.isArchived, false)))
      .limit(1);
    assert.ok(realRow, "At least one real school must exist in the DB");
    realSchoolId = realRow.id;

    /* Create a NETWORK_LEADER (schoolId null — matches session-expiry test pattern) */
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
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

    nlJar = await loginAs(nlId);
  });

  after(cleanup);

  /* 1 ── No schoolId → 403 ─────────────────────────────────────────────── */

  test("1 — NETWORK_LEADER GET /people without schoolId → 403", async () => {
    const { status, body } = await apiGet("/people", nlJar);

    assert.equal(
      status,
      403,
      `Expected 403, got ${status}: ${JSON.stringify(body)}`,
    );
    const err = (body as { error?: string }).error ?? "";
    assert.ok(
      err.toLowerCase().includes("schoolid") || err.toLowerCase().includes("school"),
      `Expected error message mentioning schoolId. Got: "${err}"`,
    );
  });

  /* 2 ── Valid schoolId → 200 ──────────────────────────────────────────── */

  test("2 — NETWORK_LEADER GET /people with valid schoolId → 200", async () => {
    const { status, body } = await apiGet(`/people?schoolId=${realSchoolId}`, nlJar);

    assert.equal(
      status,
      200,
      `Expected 200, got ${status}: ${JSON.stringify(body)}`,
    );
    assert.ok(Array.isArray(body), "Response body should be an array of people");
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
