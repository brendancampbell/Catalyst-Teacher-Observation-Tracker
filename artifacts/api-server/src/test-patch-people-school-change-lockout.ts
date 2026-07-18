/**
 * Integration tests: school-change lockout on PATCH /api/people/:employeeId
 * cannot be bypassed by a direct API call.
 *
 * The guard (people.ts ~line 667) rejects any PATCH body that contains a
 * `schoolId` field when the caller is a NETWORK_ADMIN or NETWORK_LEADER.
 * School moves must go through /reassign so the assignment ledger stays
 * accurate.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:patch-people-school-change-lockout
 *
 * Requires the dev server to be running (NODE_ENV=development).
 *
 * Scenarios:
 *   1. NETWORK_ADMIN  sends PATCH with schoolId present → 400
 *   2. NETWORK_LEADER sends PATCH with schoolId present → 400
 *   3. NETWORK_ADMIN  sends PATCH without schoolId      → 200 (guard is specific)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
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
  return `TPSCL${ts}`;
}

async function cleanup() {
  if (testPersonEmployeeIds.length > 0) {
    await db.delete(people).where(inArray(people.employeeId, testPersonEmployeeIds));
    testPersonEmployeeIds = [];
  }
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("PATCH /api/people/:employeeId — school-change lockout guard", () => {
  let naJar:  Jar;
  let nlJar:  Jar;
  let naId:   string;
  let nlId:   string;
  let targetEmployeeId: string;
  let realSchoolId:     number;
  let hoSchoolId:       number;

  before(async () => {
    /* Find a real (non-Home-Office) school and the Home Office school */
    const [realRow] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, false))
      .limit(1);
    assert.ok(realRow, "At least one real school must exist in the DB");
    realSchoolId = realRow.id;

    const [hoRow] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, true))
      .limit(1);
    assert.ok(hoRow, "A Home Office school must exist in the DB");
    hoSchoolId = hoRow.id;

    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);

    /* Create a NETWORK_ADMIN assigned to the Home Office school */
    naId = makeEmployeeId();
    await db.insert(people).values({
      employeeId:               naId,
      firstName:                "Test",
      lastName:                 `NA${ts}`,
      email:                    `test.na.${ts}@example.com`,
      role:                     "NETWORK_ADMIN",
      schoolId:                 hoSchoolId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    testPersonEmployeeIds.push(naId);

    /* Create a NETWORK_LEADER assigned to the Home Office school */
    nlId = makeEmployeeId();
    await db.insert(people).values({
      employeeId:               nlId,
      firstName:                "Test",
      lastName:                 `NL${ts}`,
      email:                    `test.nl.${ts}@example.com`,
      role:                     "NETWORK_LEADER",
      schoolId:                 hoSchoolId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    testPersonEmployeeIds.push(nlId);

    /* Create a COACH target person assigned to the real school */
    targetEmployeeId = makeEmployeeId();
    await db.insert(people).values({
      employeeId:               targetEmployeeId,
      firstName:                "Target",
      lastName:                 `Coach${ts}`,
      email:                    `target.coach.${ts}@example.com`,
      role:                     "COACH",
      schoolId:                 realSchoolId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    testPersonEmployeeIds.push(targetEmployeeId);

    naJar = await loginAs(naId);
    nlJar = await loginAs(nlId);
  });

  after(async () => {
    await cleanup();
  });

  /* 1 ── NETWORK_ADMIN sends schoolId in PATCH body → 400 ──────────────── */

  test("1 — NETWORK_ADMIN PATCH with schoolId → 400", async () => {
    const patchRes = await apiPatch(
      `/people/${targetEmployeeId}`,
      { schoolId: realSchoolId },
      naJar,
    );

    assert.equal(
      patchRes.status,
      400,
      `Expected 400, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`,
    );
    const body = patchRes.body as { error?: string };
    assert.ok(
      typeof body.error === "string" && body.error.toLowerCase().includes("reassign"),
      `Expected error mentioning "reassign". Got: "${body.error}"`,
    );
  });

  /* 2 ── NETWORK_LEADER sends schoolId in PATCH body → 400 ─────────────── */

  test("2 — NETWORK_LEADER PATCH with schoolId → 400", async () => {
    const patchRes = await apiPatch(
      `/people/${targetEmployeeId}`,
      { schoolId: realSchoolId },
      nlJar,
    );

    assert.equal(
      patchRes.status,
      400,
      `Expected 400, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`,
    );
    const body = patchRes.body as { error?: string };
    assert.ok(
      typeof body.error === "string" && body.error.toLowerCase().includes("reassign"),
      `Expected error mentioning "reassign". Got: "${body.error}"`,
    );
  });

  /* 3 ── NETWORK_ADMIN PATCH without schoolId → 200 (guard is specific) ── */

  test("3 — NETWORK_ADMIN PATCH without schoolId → 200", async () => {
    const patchRes = await apiPatch(
      `/people/${targetEmployeeId}`,
      { firstName: "Updated" },
      naJar,
    );

    assert.equal(
      patchRes.status,
      200,
      `Expected 200, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`,
    );
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
