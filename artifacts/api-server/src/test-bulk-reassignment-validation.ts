/**
 * Integration tests: validation gates still block bad re-assignments for existing staff.
 *
 * The bulk upsert change (Task #476) added an "assigned" path for existing users.
 * These tests confirm the validation block (role-escalation guard, Home Office guard,
 * school-not-found guard) runs BEFORE the upsert branch and rejects bad rows even
 * when the target person already exists in the DB.
 *
 * Scenarios:
 *   1. Existing person re-assigned with a school-level role (COACH) to the
 *      Home Office pseudo-school → row status "error"
 *   2. Existing person re-assigned to a non-existent school name → row status "error"
 *   3. SCHOOL_LEADER tries to re-assign an existing person from their school
 *      to a network-level role → row status "error"
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:bulk-reassignment-validation
 *
 * Requires the dev server to be running (NODE_ENV=development).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── Fixed test user IDs ──────────────────────────────────────────────────── */

const NETWORK_ADMIN_EID = "U10"; /* Brendan Campbell — NETWORK_ADMIN, not school-scoped */

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ employeeId }),
  });
  const setCookie = res.headers.get("set-cookie");
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}`);
  assert.ok(setCookie, "dev-login should return a Set-Cookie header");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

async function apiBulk(
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}/people/bulk`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.cookieHeader },
    body:    JSON.stringify(body),
  });
  let responseBody: unknown;
  try { responseBody = await res.json(); } catch { responseBody = null; }
  return { status: res.status, body: responseBody };
}

/* ── Employee ID factory ──────────────────────────────────────────────────── */

let seededEmployeeIds: string[] = [];

function makeEmployeeId(prefix = "TBRV"): string {
  const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
  return `${prefix}${ts}`;
}

function makeEmail(tag: string): string {
  return `test.bulk.rval.${tag}.${Date.now()}@example.com`;
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("POST /api/people/bulk — validation blocks bad re-assignments for existing staff", () => {
  let naJar:   Jar;           /* NETWORK_ADMIN session */
  let slJar:   Jar;           /* SCHOOL_LEADER session */
  let realSchoolId:   number; /* A real (non-HO) school */
  let hoSchoolId:     number; /* Home Office pseudo-school ID */
  let hoSchoolName:   string; /* Home Office displayName for CSV school field */
  let slEmployeeId:   string; /* Temp SCHOOL_LEADER for test 3 */

  before(async () => {
    /* Discover school IDs dynamically so the test is not coupled to seeded data */
    const [realRow] = await db
      .select({ id: schools.id, displayName: schools.displayName })
      .from(schools)
      .where(eq(schools.isHomeOffice, false))
      .limit(1);
    assert.ok(realRow, "At least one real (non-Home-Office) school must exist");
    realSchoolId = realRow.id;

    const [hoRow] = await db
      .select({ id: schools.id, displayName: schools.displayName })
      .from(schools)
      .where(eq(schools.isHomeOffice, true))
      .limit(1);
    assert.ok(hoRow, "A Home Office school must exist (bootstrapped by the server)");
    hoSchoolId   = hoRow.id;
    hoSchoolName = hoRow.displayName;

    naJar = await loginAs(NETWORK_ADMIN_EID);

    /* Create a temp SCHOOL_LEADER at the real school for test 3 */
    slEmployeeId = makeEmployeeId("TBRV_SL");
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    await db.insert(people).values({
      employeeId:               slEmployeeId,
      firstName:                "Test",
      lastName:                 `BRValSL${ts}`,
      email:                    makeEmail(`sl${ts}`),
      role:                     "SCHOOL_LEADER",
      schoolId:                 realSchoolId,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();
    seededEmployeeIds.push(slEmployeeId);

    slJar = await loginAs(slEmployeeId);
  });

  after(async () => {
    if (seededEmployeeIds.length > 0) {
      await db.delete(people).where(inArray(people.employeeId, seededEmployeeIds)).catch(() => {});
      seededEmployeeIds = [];
    }
  });

  /* ── Test 1: Home Office guard fires for existing person ───────────────── */

  test("1 — re-assigning an existing COACH to Home Office school → row status 'error'", async () => {
    /* Seed an existing COACH at the real school */
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    const empId = makeEmployeeId();
    const email = makeEmail(`ho${ts}`);
    seededEmployeeIds.push(empId);

    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 `BRV1${ts}`,
      email,
      role:                     "COACH",
      schoolId:                 realSchoolId,
      isActive:                 true,
      includeInFeedbackTracker: false,
    });

    /* NETWORK_ADMIN attempts to re-assign them to the Home Office school as COACH */
    const res = await apiBulk([{
      employeeId: empId,
      firstName:  "Test",
      lastName:   `BRV1${ts}`,
      email,
      role:       "COACH",
      school:     hoSchoolName,
    }], naJar);

    assert.equal(
      res.status, 200,
      `Expected HTTP 200 from bulk endpoint, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const body = res.body as { results?: Array<{ status: string; reason?: string }> };
    assert.ok(Array.isArray(body.results) && body.results.length === 1, "Expected exactly one result row");
    const row = body.results![0]!;

    assert.equal(
      row.status, "error",
      `Expected "error" because COACH cannot be placed in Home Office. Got "${row.status}". reason: ${row.reason}`,
    );
    assert.ok(
      typeof row.reason === "string" && /home office/i.test(row.reason),
      `Expected reason to mention Home Office. Got: "${row.reason}"`,
    );

    /* Confirm the person's schoolId was NOT changed */
    const [unchanged] = await db.select({ schoolId: people.schoolId })
      .from(people)
      .where(eq(people.employeeId, empId));
    assert.equal(
      unchanged?.schoolId, realSchoolId,
      `Person's schoolId should remain ${realSchoolId}, not be changed to ${hoSchoolId}`,
    );
  });

  /* ── Test 2: Invalid school guard fires for existing person ────────────── */

  test("2 — re-assigning an existing person to a non-existent school → row status 'error'", async () => {
    /* Seed an existing COACH at the real school */
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    const empId = makeEmployeeId();
    const email = makeEmail(`inv${ts}`);
    seededEmployeeIds.push(empId);

    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 `BRV2${ts}`,
      email,
      role:                     "COACH",
      schoolId:                 realSchoolId,
      isActive:                 true,
      includeInFeedbackTracker: false,
    });

    const fakeSchool = "No Such School Exists In This DB 88888";

    /* NETWORK_ADMIN attempts to move them to a school that doesn't exist */
    const res = await apiBulk([{
      employeeId: empId,
      firstName:  "Test",
      lastName:   `BRV2${ts}`,
      email,
      role:       "COACH",
      school:     fakeSchool,
    }], naJar);

    assert.equal(
      res.status, 200,
      `Expected HTTP 200 from bulk endpoint, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const body = res.body as { results?: Array<{ status: string; reason?: string }> };
    assert.ok(Array.isArray(body.results) && body.results.length === 1, "Expected exactly one result row");
    const row = body.results![0]!;

    assert.equal(
      row.status, "error",
      `Expected "error" because school doesn't exist. Got "${row.status}". reason: ${row.reason}`,
    );
    assert.ok(
      typeof row.reason === "string" && row.reason.includes(fakeSchool),
      `Expected reason to include the unknown school name. Got: "${row.reason}"`,
    );

    /* Confirm the person's schoolId was NOT changed */
    const [unchanged] = await db.select({ schoolId: people.schoolId })
      .from(people)
      .where(eq(people.employeeId, empId));
    assert.equal(
      unchanged?.schoolId, realSchoolId,
      `Person's schoolId should remain ${realSchoolId} after a rejected re-assignment`,
    );
  });

  /* ── Test 3: SCHOOL_LEADER role-escalation guard fires for existing person */

  test("3 — SCHOOL_LEADER re-assigns an existing person to a network-level role → row status 'error'", async () => {
    /* Seed an existing COACH at the SAME school as the SCHOOL_LEADER */
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    const empId = makeEmployeeId();
    const email = makeEmail(`esc${ts}`);
    seededEmployeeIds.push(empId);

    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 `BRV3${ts}`,
      email,
      role:                     "COACH",
      schoolId:                 realSchoolId,
      isActive:                 true,
      includeInFeedbackTracker: false,
    });

    /* SCHOOL_LEADER attempts to re-assign the person to NETWORK_LEADER */
    const res = await apiBulk([{
      employeeId: empId,
      firstName:  "Test",
      lastName:   `BRV3${ts}`,
      email,
      role:       "NETWORK_LEADER",
    }], slJar);

    assert.equal(
      res.status, 200,
      `Expected HTTP 200 from bulk endpoint, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const body = res.body as { results?: Array<{ status: string; reason?: string }> };
    assert.ok(Array.isArray(body.results) && body.results.length === 1, "Expected exactly one result row");
    const row = body.results![0]!;

    assert.equal(
      row.status, "error",
      `Expected "error" because SCHOOL_LEADER cannot assign network-level roles. Got "${row.status}". reason: ${row.reason}`,
    );
    assert.ok(
      typeof row.reason === "string" && /network/i.test(row.reason),
      `Expected reason to reference the network-role escalation guard. Got: "${row.reason}"`,
    );

    /* Confirm the person's role was NOT upgraded */
    const [unchanged] = await db.select({ role: people.role })
      .from(people)
      .where(eq(people.employeeId, empId));
    assert.equal(
      unchanged?.role, "COACH",
      `Person's role should remain "COACH", not be upgraded to NETWORK_LEADER`,
    );
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
