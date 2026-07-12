/**
 * Authenticated API tests for POST /api/people/bulk — school name matching.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/test-bulk-import-school-lookup.ts
 *
 * Requires the dev server to be running (NODE_ENV=development) because it
 * uses the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Test scenarios:
 *   1. School looked up by fullName → resolves to correct school id
 *   2. School looked up by displayName → resolves to correct school id
 *   3. Unmatched school name → error row with the name in the message
 *   4. fullName match takes priority over displayName match for a different school
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { schools, people } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;
const NETWORK_ADMIN_ID = "U10"; /* Brendan Campbell — confirmed NETWORK_ADMIN */

/* ── Cookie-jar helper ──────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function apiPost(path: string, body: unknown, jar?: Jar): Promise<{ status: number; body: unknown; setCookie?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar?.cookieHeader) headers["Cookie"] = jar.cookieHeader;

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const setCookie = res.headers.get("set-cookie") ?? undefined;
  let responseBody: unknown;
  try { responseBody = await res.json(); } catch { responseBody = null; }

  return { status: res.status, body: responseBody, setCookie };
}

function extractCookie(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0] ?? "";
}

/* ── Session login ──────────────────────────────────────────────────────── */

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await apiPost("/auth/dev-login", { employeeId });
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${JSON.stringify(res.body)}`);
  assert.ok(res.setCookie, "dev-login should return a Set-Cookie header");
  return { cookieHeader: extractCookie(res.setCookie!) };
}

/* ── Test-only person factory ───────────────────────────────────────────── */

let testPersonEmails: string[] = [];
let testSchoolAbbrs: string[] = [];

function makePerson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const ts = Date.now();
  const email = `test.bulk.${ts}@example.com`;
  testPersonEmails.push(email);
  return {
    firstName:   "Test",
    lastName:    `User${ts}`,
    email,
    employeeId:  `TST${ts}`,
    role:        "COACH",
    ...overrides,
  };
}

/* ── Cleanup helpers ────────────────────────────────────────────────────── */

async function cleanup() {
  if (testPersonEmails.length > 0) {
    await db.delete(people).where(inArray(people.email, testPersonEmails));
    testPersonEmails = [];
  }
  if (testSchoolAbbrs.length > 0) {
    await db.delete(schools).where(inArray(schools.abbreviation, testSchoolAbbrs));
    testSchoolAbbrs = [];
  }
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe("POST /api/people/bulk — school name matching", () => {
  let jar: Jar;

  /* Real schools from the dev DB to use in tests (id=24, NSA Lincoln Park ES) */
  const REAL_SCHOOL_ID     = 24;
  const REAL_DISPLAY_NAME  = "NSA Lincoln Park ES";
  const REAL_FULL_NAME     = "North Star Academy Lincoln Park Elementary School";

  /* Test collision school abbreviations */
  const COLLISION_A_ABBR = "TST_COLL_A";
  const COLLISION_B_ABBR = "TST_COLL_B";

  before(async () => {
    jar = await loginAs(NETWORK_ADMIN_ID);

    /* Create two schools to test fullName-over-displayName priority:
       School A has displayName = "Catalyst Test Collision School"
       School B has fullName    = "Catalyst Test Collision School"
       When bulk import looks up "Catalyst Test Collision School", School B should win. */
    testSchoolAbbrs.push(COLLISION_A_ABBR, COLLISION_B_ABBR);
    await db.insert(schools).values([
      {
        displayName:  "Catalyst Test Collision School",
        fullName:     "Catalyst Test Collision School Full Name A",
        abbreviation: COLLISION_A_ABBR,
        region:       "Newark",
        gradeSpan:    "ES",
      },
      {
        displayName:  "Catalyst Test Collision School Display B",
        fullName:     "Catalyst Test Collision School",
        abbreviation: COLLISION_B_ABBR,
        region:       "Newark",
        gradeSpan:    "MS",
      },
    ]).onConflictDoNothing();
  });

  after(async () => {
    await cleanup();
  });

  test("1 — fullName lookup resolves to correct school", async () => {
    const person = makePerson({ school: REAL_FULL_NAME, schoolId: undefined });
    const res = await apiPost("/people/bulk", [person], jar);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { results?: { status: string; reason?: string }[] };
    const row = body.results?.[0];
    assert.ok(row, "Expected a result row");
    assert.notEqual(row.status, "error", `Expected created/skipped, got error: ${row.reason}`);

    /* Verify the person was assigned to the correct school */
    const [inserted] = await db.select({ schoolId: people.schoolId, email: people.email })
      .from(people)
      .where(eq(people.email, testPersonEmails.at(-1)!));
    assert.equal(inserted?.schoolId, REAL_SCHOOL_ID, `Expected schoolId=${REAL_SCHOOL_ID}, got ${inserted?.schoolId}`);
  });

  test("2 — displayName lookup resolves to correct school", async () => {
    const person = makePerson({ school: REAL_DISPLAY_NAME });
    const res = await apiPost("/people/bulk", [person], jar);

    assert.equal(res.status, 200);
    const body = res.body as { results?: { status: string; reason?: string }[] };
    const row = body.results?.[0];
    assert.ok(row);
    assert.notEqual(row.status, "error", `Expected created/skipped, got error: ${row.reason}`);

    const [inserted] = await db.select({ schoolId: people.schoolId })
      .from(people)
      .where(eq(people.email, testPersonEmails.at(-1)!));
    assert.equal(inserted?.schoolId, REAL_SCHOOL_ID);
  });

  test("3 — unmatched school name returns error row containing the school name", async () => {
    const badSchool = "Totally Made Up School That Does Not Exist XYZ";
    const person = makePerson({ school: badSchool });
    const res = await apiPost("/people/bulk", [person], jar);

    assert.equal(res.status, 200);
    const body = res.body as { results?: { status: string; reason?: string }[] };
    const row = body.results?.[0];
    assert.ok(row);
    assert.equal(row.status, "error", `Expected error status, got "${row.status}"`);
    assert.ok(
      row.reason?.includes(badSchool),
      `Error message should contain the unmatched school name "${badSchool}", got: "${row.reason}"`
    );
  });

  test("4 — fullName match takes priority over displayName match for a different school", async () => {
    /* "Catalyst Test Collision School" is:
       - School A's displayName (id resolved by abbreviation = COLLISION_A_ABBR)
       - School B's fullName   (id resolved by abbreviation = COLLISION_B_ABBR)
       The bulk import map construction overwrites displayName entries with fullName entries,
       so the lookup should resolve to School B. */
    const [schoolA] = await db.select({ id: schools.id }).from(schools).where(eq(schools.abbreviation, COLLISION_A_ABBR));
    const [schoolB] = await db.select({ id: schools.id }).from(schools).where(eq(schools.abbreviation, COLLISION_B_ABBR));
    assert.ok(schoolA && schoolB, "Test collision schools must exist");

    const person = makePerson({ school: "Catalyst Test Collision School" });
    const res = await apiPost("/people/bulk", [person], jar);

    assert.equal(res.status, 200);
    const body = res.body as { results?: { status: string; reason?: string }[] };
    const row = body.results?.[0];
    assert.ok(row);
    assert.notEqual(row.status, "error", `Expected created/skipped, got error: ${row.reason}`);

    const [inserted] = await db.select({ schoolId: people.schoolId })
      .from(people)
      .where(eq(people.email, testPersonEmails.at(-1)!));

    assert.equal(
      inserted?.schoolId,
      schoolB.id,
      `fullName (school B id=${schoolB.id}) should win over displayName (school A id=${schoolA.id}), got schoolId=${inserted?.schoolId}`
    );
  });

  test("5 — extra whitespace in school name is trimmed and still matches", async () => {
    const paddedName = `  ${REAL_DISPLAY_NAME}  `;
    const person = makePerson({ school: paddedName });
    const res = await apiPost("/people/bulk", [person], jar);

    assert.equal(res.status, 200);
    const body = res.body as { results?: { status: string; reason?: string }[] };
    const row = body.results?.[0];
    assert.ok(row);
    assert.notEqual(row.status, "error", `Expected created/skipped, got error: ${row.reason}`);

    const [inserted] = await db.select({ schoolId: people.schoolId })
      .from(people)
      .where(eq(people.email, testPersonEmails.at(-1)!));
    assert.equal(inserted?.schoolId, REAL_SCHOOL_ID);
  });
});

/* Ensure pool closes when done so the process exits */
process.on("exit", () => { pool.end().catch(() => {}); });
