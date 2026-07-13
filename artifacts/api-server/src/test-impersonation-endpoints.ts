/**
 * Integration tests for the impersonation start/stop HTTP endpoints.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:impersonation-endpoints
 *
 * Requires the dev server running (NODE_ENV=development) so it uses
 * /api/auth/dev-login to create sessions without OAuth.
 *
 * Scenarios:
 *   1. NETWORK_ADMIN impersonates a valid active non-admin → 200
 *   2. NETWORK_ADMIN impersonates → /me reflects impersonated identity
 *   3. POST /stop-impersonating → 200, /me returns original admin identity
 *   4. Non-NETWORK_ADMIN (SCHOOL_LEADER) calling /impersonate → 403
 *   5. /impersonate with a non-existent employeeId → 404
 *   6. /impersonate with an inactive person → 403
 *   7. /impersonate targeting another NETWORK_ADMIN → 403
 *   8. /impersonate with missing body → 400
 *   9. Admin logs out while impersonation is active → 401 + no DB session row
 *  10. Session row deleted from DB (TTL expiry simulation) → 401 on /me
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── Test entity IDs ──────────────────────────────────────────────────────── */

const ADMIN_EID     = "TST_IMPERSONATE_ADMIN";      // NETWORK_ADMIN — the impersonator
const TARGET_EID    = "TST_IMPERSONATE_TARGET";     // SCHOOL_LEADER — valid target
const INACTIVE_EID  = "TST_IMPERSONATE_INACTIVE";  // inactive person
const OTHER_ADMIN   = "TST_IMPERSONATE_ADMIN2";    // another NETWORK_ADMIN — cannot be impersonated
const SL_EID        = "TST_IMPERSONATE_SL";        // SCHOOL_LEADER — cannot start impersonation

const ALL_EIDS = [ADMIN_EID, TARGET_EID, INACTIVE_EID, OTHER_ADMIN, SL_EID];

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

  /* Capture any updated cookie the server sends back */
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
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

describe("Impersonation start/stop endpoint authorization", () => {
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
        employeeId:               ADMIN_EID,
        firstName:                "Test",
        lastName:                 "ImpersonateAdmin",
        email:                    "tst.impersonate.admin@example.com",
        role:                     "NETWORK_ADMIN",
        schoolId:                 null,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               TARGET_EID,
        firstName:                "Test",
        lastName:                 "ImpersonateTarget",
        email:                    "tst.impersonate.target@example.com",
        role:                     "SCHOOL_LEADER",
        schoolId:                 SCHOOL_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               INACTIVE_EID,
        firstName:                "Test",
        lastName:                 "ImpersonateInactive",
        email:                    "tst.impersonate.inactive@example.com",
        role:                     "COACH",
        schoolId:                 SCHOOL_ID,
        isActive:                 false,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               OTHER_ADMIN,
        firstName:                "Test",
        lastName:                 "ImpersonateAdmin2",
        email:                    "tst.impersonate.admin2@example.com",
        role:                     "NETWORK_ADMIN",
        schoolId:                 null,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               SL_EID,
        firstName:                "Test",
        lastName:                 "ImpersonateSL",
        email:                    "tst.impersonate.sl@example.com",
        role:                     "SCHOOL_LEADER",
        schoolId:                 SCHOOL_ID,
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

  /* 1 ── NETWORK_ADMIN impersonates valid target → 200 ────────────────────── */

  test("1 — NETWORK_ADMIN impersonating a valid active non-admin returns 200", async () => {
    const adminJar = await loginAs(ADMIN_EID);
    const res = await request("POST", "/auth/impersonate", { employeeId: TARGET_EID }, adminJar);
    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const body = res.body as { ok: boolean; impersonating: { employeeId: string } };
    assert.equal(body.ok, true);
    assert.equal(body.impersonating.employeeId, TARGET_EID);
  });

  /* 2 ── After impersonation /me reflects the impersonated identity ────────── */

  test("2 — After starting impersonation /me returns the impersonated person's identity", async () => {
    const adminJar = await loginAs(ADMIN_EID);

    const startRes = await request("POST", "/auth/impersonate", { employeeId: TARGET_EID }, adminJar);
    assert.equal(startRes.status, 200, `Expected 200, got ${startRes.status}`);

    /* Use the cookie returned by the impersonate call (session may be regenerated) */
    const sessionJar = startRes.jar;

    const meRes = await request("GET", "/auth/me", undefined, sessionJar);
    assert.equal(meRes.status, 200, `/me failed: ${meRes.status}`);

    const me = meRes.body as { employeeId: string; _isImpersonating?: boolean };
    assert.equal(
      me.employeeId,
      TARGET_EID,
      `/me should reflect the impersonated identity (${TARGET_EID}), got ${me.employeeId}`,
    );
    assert.equal(me._isImpersonating, true, "/me should report _isImpersonating: true");
  });

  /* 3 ── stop-impersonating restores original identity ─────────────────────── */

  test("3 — POST /stop-impersonating restores the original admin identity", async () => {
    const adminJar = await loginAs(ADMIN_EID);

    const startRes = await request("POST", "/auth/impersonate", { employeeId: TARGET_EID }, adminJar);
    assert.equal(startRes.status, 200, `Expected 200, got ${startRes.status}`);

    const sessionJar = startRes.jar;

    const stopRes = await request("POST", "/auth/stop-impersonating", undefined, sessionJar);
    assert.equal(stopRes.status, 200, `stop-impersonating failed: ${stopRes.status}`);
    const stopBody = stopRes.body as { ok: boolean };
    assert.equal(stopBody.ok, true);

    const afterJar = stopRes.jar;

    const meRes = await request("GET", "/auth/me", undefined, afterJar);
    assert.equal(meRes.status, 200);
    const me = meRes.body as { employeeId: string; _isImpersonating?: boolean };
    assert.equal(
      me.employeeId,
      ADMIN_EID,
      `After stopping impersonation /me should return the original admin (${ADMIN_EID}), got ${me.employeeId}`,
    );
    assert.equal(
      me._isImpersonating,
      false,
      "/me should report _isImpersonating: false after stop",
    );
  });

  /* 4 ── Non-NETWORK_ADMIN cannot start impersonation → 403 ─────────────────── */

  test("4 — SCHOOL_LEADER calling /impersonate receives 403", async () => {
    const slJar = await loginAs(SL_EID);
    const res = await request("POST", "/auth/impersonate", { employeeId: TARGET_EID }, slJar);
    assert.equal(
      res.status,
      403,
      `Expected 403 for non-admin impersonation attempt, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 5 ── Non-existent employeeId → 404 ─────────────────────────────────────── */

  test("5 — /impersonate with a non-existent employeeId returns 404", async () => {
    const adminJar = await loginAs(ADMIN_EID);
    const res = await request(
      "POST",
      "/auth/impersonate",
      { employeeId: "DOES_NOT_EXIST_XYZ_12345" },
      adminJar,
    );
    assert.equal(
      res.status,
      404,
      `Expected 404 for unknown employeeId, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 6 ── Inactive person → 403 ─────────────────────────────────────────────── */

  test("6 — /impersonate with an inactive person returns 403", async () => {
    const adminJar = await loginAs(ADMIN_EID);
    const res = await request("POST", "/auth/impersonate", { employeeId: INACTIVE_EID }, adminJar);
    assert.equal(
      res.status,
      403,
      `Expected 403 for inactive target, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 7 ── Cannot impersonate another NETWORK_ADMIN → 403 ────────────────────── */

  test("7 — /impersonate targeting another NETWORK_ADMIN returns 403", async () => {
    const adminJar = await loginAs(ADMIN_EID);
    const res = await request("POST", "/auth/impersonate", { employeeId: OTHER_ADMIN }, adminJar);
    assert.equal(
      res.status,
      403,
      `Expected 403 when targeting another NETWORK_ADMIN, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 8 ── Missing body → 400 ────────────────────────────────────────────────── */

  test("8 — /impersonate with no employeeId in body returns 400", async () => {
    const adminJar = await loginAs(ADMIN_EID);
    const res = await request("POST", "/auth/impersonate", {}, adminJar);
    assert.equal(
      res.status,
      400,
      `Expected 400 for missing employeeId, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  /* 9 ── Logout while impersonating destroys session ───────────────────────── */

  test("9 — Admin logout while impersonation is active destroys the session (401 + no DB row)", async () => {
    const adminJar = await loginAs(ADMIN_EID);

    /* Start impersonation */
    const startRes = await request("POST", "/auth/impersonate", { employeeId: TARGET_EID }, adminJar);
    assert.equal(startRes.status, 200, `Expected 200 starting impersonation, got ${startRes.status}`);

    const impersonatingJar = startRes.jar;

    /* Extract the raw session ID from the cookie so we can query the DB later.
       Cookie value looks like: connect.sid=s%3A<sid>.<signature>
       After decoding: s:<sid>.<signature>                                       */
    const rawCookieValue = impersonatingJar.cookieHeader.split("=").slice(1).join("=");
    const decoded = decodeURIComponent(rawCookieValue);
    const sid: string | null = decoded.startsWith("s:")
      ? (decoded.slice(2).split(".")[0] ?? null)
      : null;

    /* Logout while impersonation is still active */
    const logoutRes = await fetch(`${BASE}/auth/logout`, {
      method: "POST",
      headers: { Cookie: impersonatingJar.cookieHeader },
      redirect: "manual",
    });
    assert.ok(
      logoutRes.status >= 200 && logoutRes.status < 400,
      `Expected logout to succeed (2xx/3xx), got ${logoutRes.status}`,
    );

    /* Subsequent /me with the same cookie must return 401 */
    const meRes = await request("GET", "/auth/me", undefined, impersonatingJar);
    assert.equal(
      meRes.status,
      401,
      `/me should return 401 after logout during impersonation, got ${meRes.status}: ${JSON.stringify(meRes.body)}`,
    );

    /* No lingering session row should remain in the DB */
    if (sid) {
      const result = await pool.query<{ sid: string }>(
        `SELECT sid FROM session WHERE sid = $1`,
        [sid],
      );
      assert.equal(
        result.rows.length,
        0,
        `Session table must have no row for sid="${sid}" after logout, but found ${result.rows.length} row(s)`,
      );
    }
  });
  /* 10 ── Expired session (row deleted) → 401 on /me ────────────────────────
     Simulates TTL expiry by deleting the session row from the store directly.
     The cookie still has a valid signature, but connect-pg-simple cannot find
     the row, so passport deserialises nothing and the request is unauthenticated. */

  test("10 — Deleting session row from the store (TTL expiry simulation) causes /me to return 401", async () => {
    const adminJar = await loginAs(ADMIN_EID);

    /* Start impersonation so the session has both fields populated */
    const startRes = await request("POST", "/auth/impersonate", { employeeId: TARGET_EID }, adminJar);
    assert.equal(startRes.status, 200, `Expected 200 starting impersonation, got ${startRes.status}`);

    const impersonatingJar = startRes.jar;

    /* Confirm /me works before we tamper with the session store */
    const meBeforeRes = await request("GET", "/auth/me", undefined, impersonatingJar);
    assert.equal(meBeforeRes.status, 200, `/me should work before deletion, got ${meBeforeRes.status}`);

    /* Extract the raw session ID from the cookie:
       Cookie: connect.sid=s%3A<sid>.<signature>
       Decoded: s:<sid>.<signature>                                             */
    const rawCookieValue = impersonatingJar.cookieHeader.split("=").slice(1).join("=");
    const decoded = decodeURIComponent(rawCookieValue);
    const sid: string | null = decoded.startsWith("s:")
      ? (decoded.slice(2).split(".")[0] ?? null)
      : null;

    assert.ok(sid, "Could not extract sid from cookie — cookie format may have changed");

    /* Simulate TTL expiry by deleting the row directly */
    await pool.query(`DELETE FROM session WHERE sid = $1`, [sid]);

    /* Verify it is gone */
    const check = await pool.query<{ sid: string }>(`SELECT sid FROM session WHERE sid = $1`, [sid]);
    assert.equal(check.rows.length, 0, "Session row should be deleted before testing /me");

    /* /me with the now-orphaned cookie must return 401 */
    const meAfterRes = await request("GET", "/auth/me", undefined, impersonatingJar);
    assert.equal(
      meAfterRes.status,
      401,
      `/me must return 401 after session row is deleted (TTL expiry), got ${meAfterRes.status}: ${JSON.stringify(meAfterRes.body)}`,
    );
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
