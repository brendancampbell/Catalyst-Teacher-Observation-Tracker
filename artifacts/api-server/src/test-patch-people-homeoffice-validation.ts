/**
 * Integration tests for Home Office / school assignment validation in
 * PATCH /api/people/:employeeId.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/test-patch-people-homeoffice-validation.ts
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. PATCH a COACH's schoolId to Home Office         → 400 error
 *   2. PATCH a NETWORK_LEADER's schoolId to real school → 400 error
 *   3. PATCH a NETWORK_LEADER's schoolId to Home Office → 200 success
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;
const NETWORK_ADMIN_ID = "U10"; /* Brendan Campbell — NETWORK_ADMIN */

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

async function apiPost(
  path: string,
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
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

/* ── Test person factory ──────────────────────────────────────────────────── */

let testPersonEmployeeIds: string[] = [];

function makeEmployeeId(): string {
  const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
  return `TPHO${ts}`;
}

function makePerson(overrides: Record<string, unknown> = {}): Record<string, unknown> & { employeeId: string } {
  const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
  const employeeId = `TPHO${ts}`;
  testPersonEmployeeIds.push(employeeId);
  return {
    firstName:  "Test",
    lastName:   `HO${ts}`,
    email:      `test.ho.${ts}@example.com`,
    employeeId,
    role:       "COACH",
    ...overrides,
  };
}

/* ── Cleanup ──────────────────────────────────────────────────────────────── */

async function cleanup() {
  if (testPersonEmployeeIds.length > 0) {
    await db.delete(people).where(inArray(people.employeeId, testPersonEmployeeIds));
    testPersonEmployeeIds = [];
  }
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("PATCH /api/people/:employeeId — Home Office school validation", () => {
  let jar: Jar;
  let homeOfficeSchoolId: number;
  let realSchoolId: number;

  before(async () => {
    jar = await loginAs(NETWORK_ADMIN_ID);

    /* Discover the Home Office pseudo-school from the DB */
    const [hoRow] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, true))
      .limit(1);
    assert.ok(hoRow, "Home Office school must exist in the DB");
    homeOfficeSchoolId = hoRow.id;

    /* Find a real (non-Home-Office) school */
    const [realRow] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, false))
      .limit(1);
    assert.ok(realRow, "At least one real school must exist in the DB");
    realSchoolId = realRow.id;
  });

  after(async () => {
    await cleanup();
  });

  /* 1 ── PATCH COACH's schoolId to Home Office → 400 ──────────────────── */

  test("1 — PATCH a COACH's schoolId to Home Office → 400 with Home Office error", async () => {
    /* Create a COACH at a real school */
    const person = makePerson({ role: "COACH" });
    const bulkRes = await apiPost("/people/bulk", [{ ...person, school: realSchoolId }], jar);

    /* Bulk import uses school name/ID lookup; pass as numeric string so the
       import resolves it. If that fails, fall back to direct DB insert. */
    let created = false;
    if (bulkRes.status === 200) {
      const b = bulkRes.body as { results?: { status: string }[] };
      created = b.results?.[0]?.status === "created";
    }

    if (!created) {
      /* Direct DB insert as fallback */
      await db.insert(people).values({
        employeeId:               person.employeeId,
        firstName:                person.firstName as string,
        lastName:                 person.lastName as string,
        email:                    person.email as string,
        role:                     "COACH",
        schoolId:                 realSchoolId,
        includeInFeedbackTracker: false,
        isActive:                 true,
      });
    }

    /* Now PATCH their schoolId to the Home Office school */
    const patchRes = await apiPatch(`/people/${person.employeeId}`, { schoolId: homeOfficeSchoolId }, jar);

    assert.equal(
      patchRes.status,
      400,
      `Expected 400, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`,
    );
    const body = patchRes.body as { error?: string };
    assert.ok(
      body.error?.toLowerCase().includes("home office"),
      `error should mention "Home Office". Got: "${body.error}"`,
    );
  });

  /* 2 ── PATCH NETWORK_LEADER's schoolId to a real school → 400 ───────── */

  test("2 — PATCH a NETWORK_LEADER's schoolId to a real school → 400 with Home Office error", async () => {
    /* Create a NETWORK_LEADER at Home Office via direct DB insert */
    const empId = makeEmployeeId();
    testPersonEmployeeIds.push(empId);
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 `NL${ts}`,
      email:                    `test.nl.${ts}@example.com`,
      role:                     "NETWORK_LEADER",
      schoolId:                 homeOfficeSchoolId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });

    /* PATCH their schoolId to a real school */
    const patchRes = await apiPatch(`/people/${empId}`, { schoolId: realSchoolId }, jar);

    assert.equal(
      patchRes.status,
      400,
      `Expected 400, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`,
    );
    const body = patchRes.body as { error?: string };
    assert.ok(
      body.error?.toLowerCase().includes("home office"),
      `error should mention "Home Office". Got: "${body.error}"`,
    );
  });

  /* 3 ── PATCH NETWORK_LEADER's schoolId to Home Office → 200 ─────────── */

  test("3 — PATCH a NETWORK_LEADER's schoolId to Home Office → 200 success", async () => {
    /* Create a NETWORK_LEADER — start them at Home Office (valid state) then
       move them to a real school directly in the DB, then PATCH back to Home
       Office to confirm the happy path returns 200. */
    const empId = makeEmployeeId();
    testPersonEmployeeIds.push(empId);
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 `NLBack${ts}`,
      email:                    `test.nlback.${ts}@example.com`,
      role:                     "NETWORK_LEADER",
      schoolId:                 realSchoolId, /* intentionally wrong state */
      includeInFeedbackTracker: false,
      isActive:                 true,
    });

    /* PATCH back to Home Office — should succeed */
    const patchRes = await apiPatch(`/people/${empId}`, { schoolId: homeOfficeSchoolId }, jar);

    assert.equal(
      patchRes.status,
      200,
      `Expected 200, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`,
    );
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
