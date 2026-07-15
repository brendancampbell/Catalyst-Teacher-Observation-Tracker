/**
 * Integration test: GET /api/people?includeInFeedbackTracker=true must never
 * return a person whose school has isHomeOffice=true, even when that person's
 * includeInFeedbackTracker column is set to true directly in the database
 * (simulating a stale/corrupted record that bypassed application-level guards).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/test-feedback-tracker-homeoffice-exclusion.ts
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. Home Office person with includeInFeedbackTracker=true (direct DB write)
 *      → absent from GET /api/people?includeInFeedbackTracker=true
 *   2. Non-Home-Office person with includeInFeedbackTracker=true
 *      → present in the same response (sanity check)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, and } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;
const NETWORK_ADMIN_ID = "U10"; /* Brendan Campbell — NETWORK_ADMIN */

const HO_PERSON_EID  = "TST_FT_HOMEOFFICE_EXCL";
const REG_PERSON_EID = "TST_FT_REGULAR_INCL";

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function apiGet(path: string, jar: Jar): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Cookie": jar.cookieHeader },
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
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}`);
  assert.ok(setCookie, "dev-login should return a Set-Cookie header");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("Feedback Tracker — Home Office exclusion guard", () => {
  let jar: Jar;
  let homeOfficeSchoolId: number;
  let regularSchoolId: number;

  before(async () => {
    jar = await loginAs(NETWORK_ADMIN_ID);

    /* Resolve the Home Office school from the live DB */
    const [hoRow] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, true))
      .limit(1);
    assert.ok(hoRow, "A Home Office school must exist in the database");
    homeOfficeSchoolId = hoRow.id;

    /* Resolve a regular (non-Home-Office) school for the sanity-check person */
    const [regRow] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, false))
      .limit(1);
    assert.ok(regRow, "At least one non-Home-Office school must exist in the database");
    regularSchoolId = regRow.id;

    /* Clean up any leftover records from a previous failed run */
    await db.delete(people).where(eq(people.employeeId, HO_PERSON_EID));
    await db.delete(people).where(eq(people.employeeId, REG_PERSON_EID));

    /* Insert the Home Office test person DIRECTLY via SQL, bypassing API
       validation — this simulates a stale record that an admin wrote directly
       to the database (the exact attack scenario this guard protects against). */
    await db.insert(people).values({
      employeeId:               HO_PERSON_EID,
      firstName:                "HomeOffice",
      lastName:                 "TestPerson",
      email:                    "tst.ft.homeoffice.excl@example-test.invalid",
      role:                     "NETWORK_ADMIN",
      schoolId:                 homeOfficeSchoolId,
      includeInFeedbackTracker: true,   /* stale / corrupted flag */
      isActive:                 true,
    });

    /* Insert a regular person via SQL as well, also with the flag set,
       so we can confirm the endpoint still returns non-Home-Office people. */
    await db.insert(people).values({
      employeeId:               REG_PERSON_EID,
      firstName:                "Regular",
      lastName:                 "TestPerson",
      email:                    "tst.ft.regular.incl@example-test.invalid",
      role:                     "COACH",
      schoolId:                 regularSchoolId,
      includeInFeedbackTracker: true,
      isActive:                 true,
    });
  });

  after(async () => {
    await db.delete(people).where(eq(people.employeeId, HO_PERSON_EID));
    await db.delete(people).where(eq(people.employeeId, REG_PERSON_EID));
  });

  test("Home Office person is absent from ?includeInFeedbackTracker=true even when flag is set in DB", async () => {
    const res = await apiGet("/people?includeInFeedbackTracker=true", jar);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    const rows = res.body as Array<{ employeeId: string }>;
    assert.ok(Array.isArray(rows), "Response should be an array");

    const found = rows.some((r) => r.employeeId === HO_PERSON_EID);
    assert.equal(
      found,
      false,
      `Home Office person (${HO_PERSON_EID}) must not appear in the Feedback Tracker list, but it did`,
    );
  });

  test("Non-Home-Office person with includeInFeedbackTracker=true is present (sanity check)", async () => {
    const res = await apiGet("/people?includeInFeedbackTracker=true", jar);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    const rows = res.body as Array<{ employeeId: string }>;
    assert.ok(Array.isArray(rows), "Response should be an array");

    const found = rows.some((r) => r.employeeId === REG_PERSON_EID);
    assert.equal(
      found,
      true,
      `Regular person (${REG_PERSON_EID}) should appear in the Feedback Tracker list, but it did not`,
    );
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
