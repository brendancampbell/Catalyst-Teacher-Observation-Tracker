/**
 * End-to-end regression test: AI quota grants bypass the rate limiter only
 * after the normal window is exhausted.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:ai-quota-grant-bypass
 *
 * Requires the dev server to be running (NODE_ENV=development).
 *
 * Scenarios:
 *   1. Requests 1–20 from a fresh user → all pass through (400, not 429)
 *   2. Create a quota grant (1 extra chat request) for that user
 *   3. Request 21 → handler fires, grant consumed, next() allows it through → 400
 *   4. DB check → used_requests = 1 (grant fully consumed)
 *   5. Request 22 → grant exhausted → 429
 *   6. Access-control sanity: school leader cannot create a quota grant (403)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools, aiQuotaGrants } from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* Unique employee ID — guarantees a fresh rate-limit bucket every run */
const TESTER_EID   = `TST_QUOTA_BYPASS_${Date.now()}`;
const LEADER_EID   = `TST_QUOTA_LEADER_${Date.now()}`;
const ADMIN_EID    = "U10"; /* Brendan Campbell — NETWORK_ADMIN (seed data) */

type Jar = { cookieHeader: string };

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

async function request(
  method: string,
  path:   string,
  body:   unknown,
  jar:    Jar,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar.cookieHeader) headers["Cookie"] = jar.cookieHeader;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let responseBody: unknown;
  try { responseBody = await res.json(); } catch { responseBody = null; }
  return { status: res.status, body: responseBody };
}

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

/* POST to /api/ai/chat with an empty body.
   The route validates `message` before calling Anthropic, so this returns 400
   quickly while still being counted against the rate limiter window. */
async function chatProbe(jar: Jar): Promise<number> {
  const { status } = await request("POST", "/ai/chat", {}, jar);
  return status;
}

/* ── Test state ───────────────────────────────────────────────────────────── */

let testerJar:  Jar;
let adminJar:   Jar;
let leaderJar:  Jar;
let createdGrantId: number | null = null;

describe("AI quota grant — rate limiter bypass", () => {
  before(async () => {
    /* Resolve a school for the school-leader fixture */
    const [firstSchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(1);
    assert.ok(firstSchool, "Need at least 1 school in DB to run this test");
    const schoolId = firstSchool.id;

    /* Insert test users */
    await db.insert(people).values({
      employeeId:               TESTER_EID,
      firstName:                "Quota",
      lastName:                 "Tester",
      email:                    `quota.tester.${Date.now()}@example.com`,
      role:                     "NETWORK_ADMIN",
      schoolId:                 null,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

    await db.insert(people).values({
      employeeId:               LEADER_EID,
      firstName:                "Quota",
      lastName:                 "Leader",
      email:                    `quota.leader.${Date.now()}@example.com`,
      role:                     "SCHOOL_LEADER",
      schoolId:                 schoolId,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

    testerJar = await loginAs(TESTER_EID);
    adminJar  = await loginAs(ADMIN_EID);
    leaderJar = await loginAs(LEADER_EID);
  });

  after(async () => {
    /* Clean up grants created during the test */
    await db.delete(aiQuotaGrants).where(eq(aiQuotaGrants.employeeId, TESTER_EID)).catch(() => {});
    /* Clean up test people */
    await db.delete(people).where(inArray(people.employeeId, [TESTER_EID, LEADER_EID])).catch(() => {});
  });

  /* ── Test 1: exhaust the normal 20-request window ──────────────────────── */

  test("1 — Requests 1–20 pass the rate limiter (status ≠ 429)", async () => {
    const LIMIT = 20;
    for (let i = 1; i <= LIMIT; i++) {
      const status = await chatProbe(testerJar);
      assert.notEqual(
        status,
        429,
        `Request ${i}/${LIMIT} was unexpectedly rate-limited (429). The window limit may have changed.`,
      );
    }
  });

  /* ── Test 2: request 21 is blocked without a grant ─────────────────────── */

  test("2 — Request 21 hits 429 before any grant exists", async () => {
    const status = await chatProbe(testerJar);
    assert.equal(
      status,
      429,
      `Expected 429 on request 21 (no grant yet), but got ${status}.`,
    );
  });

  /* ── Test 3: create quota grant (1 extra chat request, 2-hour expiry) ──── */

  test("3 — Network admin can create a chat quota grant", async () => {
    const res = await request(
      "POST",
      "/ai/quota-grants",
      {
        employeeId:     TESTER_EID,
        grantType:      "chat",
        extraRequests:  1,
        expiresInHours: 2,
        note:           "e2e test grant",
      },
      adminJar,
    );
    assert.equal(
      res.status,
      201,
      `Expected 201 creating quota grant, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const grant = res.body as { id: number; usedRequests: number; extraRequests: number };
    assert.ok(typeof grant.id === "number" && grant.id > 0, "Grant must have a numeric id");
    assert.equal(grant.usedRequests,  0, "New grant must have usedRequests = 0");
    assert.equal(grant.extraRequests, 1, "New grant must have extraRequests = 1");
    createdGrantId = grant.id;
  });

  /* ── Test 4: school leader cannot create a quota grant (403) ───────────── */

  test("4 — School leader is denied access to create a quota grant (403)", async () => {
    const res = await request(
      "POST",
      "/ai/quota-grants",
      {
        employeeId:     TESTER_EID,
        grantType:      "chat",
        extraRequests:  1,
        expiresInHours: 2,
      },
      leaderJar,
    );
    assert.equal(
      res.status,
      403,
      `Expected 403 for school-leader creating quota grant, got ${res.status}.`,
    );
  });

  /* ── Test 5: request 22 bypasses 429 because grant is active ───────────── */

  test("5 — Request 22 is NOT rate-limited (quota grant absorbs it)", async () => {
    assert.ok(createdGrantId !== null, "Grant must have been created in test 3");

    const status = await chatProbe(testerJar);
    assert.notEqual(
      status,
      429,
      `Expected the quota grant to bypass 429 on request 22, but still got 429. Grant may not have been consumed.`,
    );
  });

  /* ── Test 6: grant's used_requests incremented to 1 in DB ──────────────── */

  test("6 — Grant used_requests is 1 after the bypass request", async () => {
    assert.ok(createdGrantId !== null, "Grant must exist");

    const [grant] = await db
      .select({ usedRequests: aiQuotaGrants.usedRequests, extraRequests: aiQuotaGrants.extraRequests })
      .from(aiQuotaGrants)
      .where(eq(aiQuotaGrants.id, createdGrantId!));

    assert.ok(grant, "Grant row must still exist in DB");
    assert.equal(
      grant.usedRequests,
      1,
      `Expected used_requests = 1 after one bypass, got ${grant.usedRequests}.`,
    );
    assert.equal(
      grant.extraRequests,
      1,
      `extraRequests should still be 1 (immutable), got ${grant.extraRequests}.`,
    );
  });

  /* ── Test 7: request 23 hits 429 (grant fully exhausted) ───────────────── */

  test("7 — Request 23 hits 429 (grant fully consumed, no more bypass)", async () => {
    const status = await chatProbe(testerJar);
    assert.equal(
      status,
      429,
      `Expected 429 on request 23 (grant exhausted), but got ${status}.`,
    );
  });

  /* ── Test 8: verify grant via GET /:employeeId API ─────────────────────── */

  test("8 — GET /ai/quota-grants/:employeeId (active-only) returns empty after exhaustion", async () => {
    const res = await request("GET", `/ai/quota-grants/${TESTER_EID}`, undefined, adminJar);
    assert.equal(
      res.status,
      200,
      `Expected 200 from GET quota-grants, got ${res.status}.`,
    );
    const grants = res.body as unknown[];
    assert.equal(
      grants.length,
      0,
      `Active-only list should be empty after the grant is exhausted (got ${grants.length} grants).`,
    );
  });

  /* ── Test 9: GET ?all=true shows the exhausted grant ───────────────────── */

  test("9 — GET /ai/quota-grants/:employeeId?all=true shows the exhausted grant in history", async () => {
    const res = await request("GET", `/ai/quota-grants/${TESTER_EID}?all=true`, undefined, adminJar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}.`);
    const grants = res.body as Array<{ id: number; usedRequests: number; extraRequests: number }>;
    assert.ok(grants.length >= 1, "History should include the exhausted grant");

    const exhausted = grants.find((g) => g.id === createdGrantId);
    assert.ok(exhausted, "Exhausted grant should appear in history view");
    assert.equal(exhausted!.usedRequests, exhausted!.extraRequests, "used_requests should equal extra_requests for an exhausted grant");
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
