/**
 * Integration tests for school-name validation in POST /api/people/bulk.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/test-bulk-people-school-validation.ts
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. Unrecognised school name             → error row; reason contains the bad name
 *   2. Numeric school ID that doesn't exist → error row; reason contains the value
 *   3. Omitted school for a network role    → person created without error
 *   4. Valid displayName                    → person created
 *   5. Valid fullName                       → person created with correct schoolId
 *   6. Mixed batch (valid + invalid)        → correct per-row results; only valid row inserted
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { people } from "@workspace/db/schema";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;
const NETWORK_ADMIN_ID = "U10"; /* Brendan Campbell — NETWORK_ADMIN */

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function apiPost(
  path: string,
  body: unknown,
  jar?: Jar,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar?.cookieHeader) headers["Cookie"] = jar.cookieHeader;

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
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

/* ── Test person factory ──────────────────────────────────────────────────── */

let testPersonEmails: string[] = [];

function makePerson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
  const email = `test.sv.${ts}@example.com`;
  testPersonEmails.push(email);
  return {
    firstName:  "Test",
    lastName:   `SV${ts}`,
    email,
    employeeId: `TSV${ts}`,
    role:       "COACH",
    ...overrides,
  };
}

/* ── Cleanup ──────────────────────────────────────────────────────────────── */

async function cleanup() {
  if (testPersonEmails.length > 0) {
    await db.delete(people).where(inArray(people.email, testPersonEmails));
    testPersonEmails = [];
  }
}

/* ── Known dev-DB school (id=24, NSA Lincoln Park ES) ────────────────────── */

const REAL_SCHOOL_ID    = 24;
const REAL_DISPLAY_NAME = "NSA Lincoln Park ES";
const REAL_FULL_NAME    = "North Star Academy Lincoln Park Elementary School";

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("POST /api/people/bulk — school-name validation", () => {
  let jar: Jar;

  before(async () => {
    jar = await loginAs(NETWORK_ADMIN_ID);
  });

  after(async () => {
    await cleanup();
  });

  /* 1 ── Unrecognised name ─────────────────────────────────────────────── */

  test("1 — unrecognised school name → error row containing the bad name", async () => {
    const badSchool = "No Such School Exists In This DB 99999";
    const person = makePerson({ school: badSchool });

    const res = await apiPost("/people/bulk", [person], jar);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { results?: { status: string; reason?: string }[] };
    assert.ok(Array.isArray(body.results), "Response must have a results array");

    const row = body.results![0];
    assert.ok(row, "Expected at least one result row");
    assert.equal(row.status, "error", `Expected "error", got "${row.status}"`);
    assert.ok(
      row.reason?.includes(badSchool),
      `reason should include the unmatched name "${badSchool}". Got: "${row.reason}"`,
    );
  });

  /* 2 ── Numeric ID that is not a real school ──────────────────────────── */

  test("2 — numeric school ID that doesn't exist → error row containing the value", async () => {
    const fakeId = "999999999";
    const person = makePerson({ school: fakeId });

    const res = await apiPost("/people/bulk", [person], jar);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { results?: { status: string; reason?: string }[] };
    assert.ok(Array.isArray(body.results), "Response must have a results array");

    const row = body.results![0];
    assert.ok(row, "Expected at least one result row");
    assert.equal(row.status, "error", `Expected "error", got "${row.status}"`);
    assert.ok(
      row.reason?.includes(fakeId),
      `reason should include "${fakeId}". Got: "${row.reason}"`,
    );
  });

  /* 3 ── No school field for a network-level role ─────────────────────── */

  test("3 — omitted school field for network-level role → person created without error", async () => {
    const person = makePerson({ role: "NETWORK_LEADER" });
    // deliberately no `school` key

    const res = await apiPost("/people/bulk", [person], jar);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { results?: { status: string; reason?: string }[] };
    assert.ok(Array.isArray(body.results), "Response must have a results array");

    const row = body.results![0];
    assert.ok(row, "Expected at least one result row");
    assert.notEqual(row.status, "error", `Expected created/skipped, got error: "${row.reason}"`);
  });

  /* 4 ── Valid displayName ─────────────────────────────────────────────── */

  test("4 — valid school displayName → person created", async () => {
    const person = makePerson({ school: REAL_DISPLAY_NAME });

    const res = await apiPost("/people/bulk", [person], jar);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { results?: { status: string; reason?: string }[] };
    assert.ok(Array.isArray(body.results), "Response must have a results array");

    const row = body.results![0];
    assert.ok(row, "Expected at least one result row");
    assert.equal(row.status, "created", `Expected "created", got "${row.status}": ${row.reason}`);
  });

  /* 5 ── Valid fullName → correct schoolId in DB ───────────────────────── */

  test("5 — valid school fullName → person created with correct schoolId", async () => {
    const person = makePerson({ school: REAL_FULL_NAME });

    const res = await apiPost("/people/bulk", [person], jar);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { results?: { status: string; reason?: string }[] };
    assert.ok(Array.isArray(body.results), "Response must have a results array");

    const row = body.results![0];
    assert.ok(row, "Expected at least one result row");
    assert.notEqual(row.status, "error", `Expected created/skipped, got error: "${row.reason}"`);

    const [inserted] = await db
      .select({ schoolId: people.schoolId })
      .from(people)
      .where(eq(people.email, testPersonEmails.at(-1)!));
    assert.equal(
      inserted?.schoolId,
      REAL_SCHOOL_ID,
      `Expected schoolId=${REAL_SCHOOL_ID}, got ${inserted?.schoolId}`,
    );
  });

  /* 6 ── Mixed batch: valid + invalid ─────────────────────────────────── */

  test("6 — mixed batch: valid school + invalid school → correct per-row results", async () => {
    const badSchool = "Definitely Not A Real School XYZ";
    const goodPerson = makePerson({ school: REAL_DISPLAY_NAME });
    const badPerson  = makePerson({ school: badSchool });

    const res = await apiPost("/people/bulk", [goodPerson, badPerson], jar);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { results?: { status: string; reason?: string }[] };
    assert.ok(Array.isArray(body.results), "Response must have a results array");
    assert.equal(body.results!.length, 2, "Expected exactly 2 result rows");

    const [goodRow, badRow] = body.results!;
    assert.ok(goodRow, "Expected result row for valid person");
    assert.ok(badRow, "Expected result row for invalid person");

    assert.equal(
      goodRow.status,
      "created",
      `Valid person should be "created", got "${goodRow.status}": ${goodRow.reason}`,
    );
    assert.equal(
      badRow.status,
      "error",
      `Invalid person should be "error", got "${badRow.status}"`,
    );
    assert.ok(
      badRow.reason?.includes(badSchool),
      `Bad row reason should include "${badSchool}". Got: "${badRow.reason}"`,
    );
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
