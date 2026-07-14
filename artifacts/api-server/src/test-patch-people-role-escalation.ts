/**
 * Integration tests: SCHOOL_LEADER cannot promote staff to network-level roles
 * via PATCH /api/people/:employeeId.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:patch-people-role-escalation
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. SCHOOL_LEADER sets role=NETWORK_LEADER on a person in their school → 403
 *   2. SCHOOL_LEADER sets role=NETWORK_ADMIN   on a person in their school → 403
 *   3. SCHOOL_LEADER sets role=COACH           on a person in their school → 200
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
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
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}`);
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

/* ── Cleanup registry ─────────────────────────────────────────────────────── */

let testPersonEmployeeIds: string[] = [];

function makeEmployeeId(): string {
  const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
  return `TPRE${ts}`;
}

async function cleanup() {
  if (testPersonEmployeeIds.length > 0) {
    await db.delete(people).where(inArray(people.employeeId, testPersonEmployeeIds));
    testPersonEmployeeIds = [];
  }
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("PATCH /api/people/:employeeId — SCHOOL_LEADER role escalation guard", () => {
  let slJar: Jar;
  let schoolLeaderId: string;
  let schoolId: number;

  before(async () => {
    /* Find a real (non-Home-Office) school to anchor the test SCHOOL_LEADER */
    const [realRow] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, false))
      .limit(1);
    assert.ok(realRow, "At least one real school must exist in the DB");
    schoolId = realRow.id;

    /* Create a test SCHOOL_LEADER assigned to that real school */
    schoolLeaderId = makeEmployeeId();
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    await db.insert(people).values({
      employeeId:               schoolLeaderId,
      firstName:                "Test",
      lastName:                 `SL${ts}`,
      email:                    `test.sl.${ts}@example.com`,
      role:                     "SCHOOL_LEADER",
      schoolId:                 schoolId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    testPersonEmployeeIds.push(schoolLeaderId);

    slJar = await loginAs(schoolLeaderId);
  });

  after(async () => {
    await cleanup();
  });

  /* 1 ── SCHOOL_LEADER → NETWORK_LEADER promotion → 403 ───────────────── */

  test("1 — SCHOOL_LEADER sets role=NETWORK_LEADER → 403", async () => {
    const empId = makeEmployeeId();
    testPersonEmployeeIds.push(empId);
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 `RE1${ts}`,
      email:                    `test.re1.${ts}@example.com`,
      role:                     "COACH",
      schoolId:                 schoolId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });

    const patchRes = await apiPatch(`/people/${empId}`, { role: "NETWORK_LEADER" }, slJar);

    assert.equal(
      patchRes.status,
      403,
      `Expected 403, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`,
    );
    const body = patchRes.body as { error?: string };
    assert.ok(
      typeof body.error === "string" && body.error.length > 0,
      `Expected a non-empty error message. Got: "${body.error}"`,
    );
  });

  /* 2 ── SCHOOL_LEADER → NETWORK_ADMIN promotion → 403 ────────────────── */

  test("2 — SCHOOL_LEADER sets role=NETWORK_ADMIN → 403", async () => {
    const empId = makeEmployeeId();
    testPersonEmployeeIds.push(empId);
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 `RE2${ts}`,
      email:                    `test.re2.${ts}@example.com`,
      role:                     "COACH",
      schoolId:                 schoolId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });

    const patchRes = await apiPatch(`/people/${empId}`, { role: "NETWORK_ADMIN" }, slJar);

    assert.equal(
      patchRes.status,
      403,
      `Expected 403, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`,
    );
    const body = patchRes.body as { error?: string };
    assert.ok(
      typeof body.error === "string" && body.error.length > 0,
      `Expected a non-empty error message. Got: "${body.error}"`,
    );
  });

  /* 3 ── SCHOOL_LEADER assigns COACH role → 200 ────────────────────────── */

  test("3 — SCHOOL_LEADER sets role=COACH on a person in their school → 200", async () => {
    const empId = makeEmployeeId();
    testPersonEmployeeIds.push(empId);
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 `RE3${ts}`,
      email:                    `test.re3.${ts}@example.com`,
      role:                     "SCHOOL_LEADER",
      schoolId:                 schoolId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });

    const patchRes = await apiPatch(`/people/${empId}`, { role: "COACH" }, slJar);

    assert.equal(
      patchRes.status,
      200,
      `Expected 200, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`,
    );
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
