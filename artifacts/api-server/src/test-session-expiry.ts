/**
 * Integration tests — session expiry causes 401 on authenticated endpoints.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:session-expiry
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * These tests prove the server-side half of the centralized 401 handler story:
 * when a session row is removed from the store (TTL expiry, manual revocation,
 * or server restart with a fresh store), every authenticated endpoint returns
 * 401 — so the client-side handler has something reliable to react to.
 *
 * Scenarios:
 *   1. Unauthenticated request → GET /auth/me → 401 (baseline)
 *   2. SCHOOL_LEADER logs in   → GET /auth/me → 200 (session works)
 *   3. Session row deleted      → GET /auth/me → 401 (TTL expiry on auth check)
 *   4. Session row deleted      → GET /people  → 401 (TTL expiry on data endpoint)
 *   5. NETWORK_LEADER logs in  → session deleted → GET /people → 401
 *   6. NETWORK_ADMIN logs in   → session deleted → GET /dashboard?rubricSet=X → 401
 *   7. Orphaned cookie replayed on /auth/me and /people both independently → 401
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";
import { asc, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── Test entity IDs ──────────────────────────────────────────────────────── */

const SL_EID    = "TST_SESS_EXPIRY_SL";    // SCHOOL_LEADER — needs a schoolId
const NL_EID    = "TST_SESS_EXPIRY_NL";    // NETWORK_LEADER — no school
const ADM_EID   = "TST_SESS_EXPIRY_ADM";   // NETWORK_ADMIN  — no school

const ALL_EIDS  = [SL_EID, NL_EID, ADM_EID];

let SCHOOL_ID: number;

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function request(
  method: string,
  path: string,
  body: unknown,
  jar: Jar,
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
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  assert.ok(setCookie, "dev-login should return Set-Cookie");
  return { cookieHeader: setCookie!.split(";")[0]! };
}

/**
 * Extracts the raw session ID from a connect-pg-simple cookie.
 * Cookie value format: connect.sid=s%3A<sid>.<signature>
 * Decoded: s:<sid>.<signature>
 */
function extractSid(jar: Jar): string {
  const rawValue = jar.cookieHeader.split("=").slice(1).join("=");
  const decoded  = decodeURIComponent(rawValue);
  assert.ok(decoded.startsWith("s:"), `Unexpected cookie format: ${decoded}`);
  const sid = decoded.slice(2).split(".")[0];
  assert.ok(sid, "Could not parse sid from cookie");
  return sid!;
}

async function deleteSession(jar: Jar): Promise<string> {
  const sid = extractSid(jar);
  await pool.query(`DELETE FROM session WHERE sid = $1`, [sid]);
  const check = await pool.query<{ sid: string }>(
    `SELECT sid FROM session WHERE sid = $1`,
    [sid],
  );
  assert.equal(check.rows.length, 0, `Session row for sid="${sid}" was not deleted`);
  return sid;
}

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

describe("Session expiry causes 401 on all authenticated endpoints", () => {
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
        employeeId:               SL_EID,
        firstName:                "Test",
        lastName:                 "SessionExpSL",
        email:                    "tst.sess.expiry.sl@example.com",
        role:                     "SCHOOL_LEADER",
        schoolId:                 SCHOOL_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               NL_EID,
        firstName:                "Test",
        lastName:                 "SessionExpNL",
        email:                    "tst.sess.expiry.nl@example.com",
        role:                     "NETWORK_LEADER",
        schoolId:                 null,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               ADM_EID,
        firstName:                "Test",
        lastName:                 "SessionExpAdm",
        email:                    "tst.sess.expiry.adm@example.com",
        role:                     "NETWORK_ADMIN",
        schoolId:                 null,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
    ]).onConflictDoNothing();
  });

  after(async () => {
    await db.delete(people)
      .where(inArray(people.employeeId, ALL_EIDS))
      .catch(() => {});
  });

  /* 1 ── Unauthenticated baseline ─────────────────────────────────────────── */

  test("1 — Unauthenticated GET /auth/me returns 401", async () => {
    const res = await request("GET", "/auth/me", undefined, { cookieHeader: "" });
    assert.equal(
      res.status,
      401,
      `Expected 401 for unauthenticated /me, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 2 ── Fresh session works ───────────────────────────────────────────────── */

  test("2 — SCHOOL_LEADER with a valid session: GET /auth/me returns 200", async () => {
    const jar = await loginAs(SL_EID);
    const res = await request("GET", "/auth/me", undefined, jar);
    assert.equal(
      res.status,
      200,
      `Expected 200 for authenticated /me, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const me = res.body as { employeeId?: string };
    assert.equal(me.employeeId, SL_EID, "/me should return the logged-in principal");
  });

  /* 3 ── Core TTL expiry test: /auth/me returns 401 after session deleted ──── */

  test("3 — Deleting SCHOOL_LEADER session row (TTL expiry) causes GET /auth/me to return 401", async () => {
    const jar = await loginAs(SL_EID);

    /* Confirm it works before expiry */
    const before = await request("GET", "/auth/me", undefined, jar);
    assert.equal(before.status, 200, `/me must work before session deletion, got ${before.status}`);

    await deleteSession(jar);

    /* Same cookie — orphaned after deletion — must now 401 */
    const after = await request("GET", "/auth/me", undefined, jar);
    assert.equal(
      after.status,
      401,
      `/me must return 401 after session row deleted (TTL expiry simulation), got ${after.status}: ${JSON.stringify(after.body)}`,
    );
  });

  /* 4 ── TTL expiry propagates to data endpoints ───────────────────────────── */

  test("4 — Expired SCHOOL_LEADER session: GET /people returns 401", async () => {
    const jar = await loginAs(SL_EID);

    const before = await request("GET", "/people", undefined, jar);
    assert.equal(before.status, 200, `GET /people must work before session deletion, got ${before.status}`);

    await deleteSession(jar);

    const after = await request("GET", "/people", undefined, jar);
    assert.equal(
      after.status,
      401,
      `GET /people must return 401 after session expiry, got ${after.status}: ${JSON.stringify(after.body)}`,
    );
  });

  /* 5 ── NETWORK_LEADER session expiry ─────────────────────────────────────── */

  test("5 — Expired NETWORK_LEADER session: GET /people returns 401", async () => {
    const jar = await loginAs(NL_EID);

    /* Task #502: NETWORK_LEADER must supply schoolId; omitting it returns 403. */
    const before = await request("GET", `/people?schoolId=${SCHOOL_ID}`, undefined, jar);
    assert.equal(before.status, 200, `GET /people must work before deletion, got ${before.status}`);

    await deleteSession(jar);

    const after = await request("GET", `/people?schoolId=${SCHOOL_ID}`, undefined, jar);
    assert.equal(
      after.status,
      401,
      `NETWORK_LEADER GET /people must return 401 after session expiry, got ${after.status}`,
    );
  });

  /* 6 ── NETWORK_ADMIN session expiry on /dashboard ────────────────────────── */

  test("6 — Expired NETWORK_ADMIN session: GET /dashboard returns 401", async () => {
    const jar = await loginAs(ADM_EID);

    /* Confirm the endpoint is reachable (200 or any non-401) before expiry */
    const before = await request("GET", "/dashboard?rubricSet=SCHOOLWI", undefined, jar);
    assert.notEqual(
      before.status,
      401,
      `GET /dashboard must not return 401 while session is valid, got ${before.status}`,
    );

    await deleteSession(jar);

    const after = await request("GET", "/dashboard?rubricSet=SCHOOLWI", undefined, jar);
    assert.equal(
      after.status,
      401,
      `GET /dashboard must return 401 after session expiry, got ${after.status}: ${JSON.stringify(after.body)}`,
    );
  });

  /* 7 ── Orphaned cookie fails independently on both /auth/me and /people ──── */

  test("7 — Orphaned cookie: /auth/me and /people both independently return 401", async () => {
    const jar = await loginAs(SL_EID);
    await deleteSession(jar);

    const [meRes, peopleRes] = await Promise.all([
      request("GET", "/auth/me",  undefined, jar),
      request("GET", "/people",   undefined, jar),
    ]);

    assert.equal(
      meRes.status,
      401,
      `GET /auth/me must return 401 with orphaned cookie, got ${meRes.status}`,
    );
    assert.equal(
      peopleRes.status,
      401,
      `GET /people must return 401 with orphaned cookie, got ${peopleRes.status}`,
    );
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
