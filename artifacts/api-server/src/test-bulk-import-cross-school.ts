/**
 * Integration tests: SCHOOL_LEADER cannot import people into a foreign school
 * via POST /api/people/bulk by supplying a different `school` field.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:bulk-import-cross-school
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. SCHOOL_LEADER supplies a foreign school name → person is created in
 *      the leader's own school, NOT in the foreign school.
 *   2. SCHOOL_LEADER supplies a foreign school ID  → person is created in
 *      the leader's own school, NOT in the foreign school.
 *   3. Confirm the inserted person's schoolId equals the leader's schoolId,
 *      not the foreign school's id.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { inArray, eq, and, ne } from "drizzle-orm";
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

async function apiBulk(
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}/people/bulk`, {
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

/* ── Helpers ──────────────────────────────────────────────────────────────── */

let testPersonEmployeeIds: string[] = [];

function makeEmployeeId(): string {
  const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
  return `TBCS${ts}`;
}

async function cleanup() {
  if (testPersonEmployeeIds.length > 0) {
    await db.delete(people).where(inArray(people.employeeId, testPersonEmployeeIds));
    testPersonEmployeeIds = [];
  }
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("POST /api/people/bulk — SCHOOL_LEADER cross-school import guard", () => {
  let slJar: Jar;
  let schoolLeaderId: string;
  let leaderSchoolId: number;
  let foreignSchoolId: number;
  let foreignSchoolName: string;

  before(async () => {
    /* Find two real (non-Home-Office) schools */
    const realSchools = await db
      .select({ id: schools.id, displayName: schools.displayName })
      .from(schools)
      .where(eq(schools.isHomeOffice, false))
      .limit(2);

    assert.ok(
      realSchools.length >= 2,
      "At least two real (non-Home-Office) schools must exist in the DB",
    );

    leaderSchoolId    = realSchools[0]!.id;
    foreignSchoolId   = realSchools[1]!.id;
    foreignSchoolName = realSchools[1]!.displayName;

    /* Create a test SCHOOL_LEADER in school A */
    schoolLeaderId = makeEmployeeId();
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    await db.insert(people).values({
      employeeId:               schoolLeaderId,
      firstName:                "Test",
      lastName:                 `BulkCS${ts}`,
      email:                    `test.bulk.cs.${ts}@example.com`,
      role:                     "SCHOOL_LEADER",
      schoolId:                 leaderSchoolId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    testPersonEmployeeIds.push(schoolLeaderId);

    slJar = await loginAs(schoolLeaderId);
  });

  after(async () => {
    await cleanup();
  });

  /* 1 ── SCHOOL_LEADER supplies a foreign school *name* ─────────────────── */

  test("1 — SCHOOL_LEADER supplies foreign school name → person lands in leader's own school", async () => {
    const empId = makeEmployeeId();
    testPersonEmployeeIds.push(empId);
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);

    const res = await apiBulk([
      {
        employeeId: empId,
        firstName:  "Test",
        lastName:   `BCS1${ts}`,
        email:      `test.bcs1.${ts}@example.com`,
        role:       "NO_ACCESS",
        school:     foreignSchoolName,
      },
    ], slJar);

    assert.equal(
      res.status,
      200,
      `Expected HTTP 200 from bulk endpoint, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const body = res.body as { results?: Array<{ status: string; reason?: string }> };
    assert.ok(Array.isArray(body.results) && body.results.length === 1, "Expected one result row");
    const row = body.results![0]!;

    /* The row must have been created (not errored) */
    assert.equal(
      row.status,
      "created",
      `Expected row status "created", got "${row.status}". reason: ${row.reason}`,
    );

    /* Confirm the person exists in the DB */
    const [inserted] = await db
      .select({ schoolId: people.schoolId })
      .from(people)
      .where(eq(people.employeeId, empId));

    assert.ok(inserted, "Person should have been inserted into the DB");

    /* The person must be in the leader's school, NOT the foreign school */
    assert.equal(
      inserted.schoolId,
      leaderSchoolId,
      `Expected person.schoolId=${leaderSchoolId} (leader's school) but got ${inserted.schoolId}`,
    );

    assert.notEqual(
      inserted.schoolId,
      foreignSchoolId,
      `Person must NOT be inserted under the foreign schoolId=${foreignSchoolId}`,
    );
  });

  /* 2 ── SCHOOL_LEADER supplies a foreign school *ID* ──────────────────── */

  test("2 — SCHOOL_LEADER supplies foreign school ID → person lands in leader's own school", async () => {
    const empId = makeEmployeeId();
    testPersonEmployeeIds.push(empId);
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);

    const res = await apiBulk([
      {
        employeeId: empId,
        firstName:  "Test",
        lastName:   `BCS2${ts}`,
        email:      `test.bcs2.${ts}@example.com`,
        role:       "NO_ACCESS",
        school:     String(foreignSchoolId),
      },
    ], slJar);

    assert.equal(
      res.status,
      200,
      `Expected HTTP 200 from bulk endpoint, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const body = res.body as { results?: Array<{ status: string; reason?: string }> };
    assert.ok(Array.isArray(body.results) && body.results.length === 1, "Expected one result row");
    const row = body.results![0]!;

    /* The row must have been created (not errored) */
    assert.equal(
      row.status,
      "created",
      `Expected row status "created", got "${row.status}". reason: ${row.reason}`,
    );

    /* Confirm the person exists in the DB */
    const [inserted] = await db
      .select({ schoolId: people.schoolId })
      .from(people)
      .where(eq(people.employeeId, empId));

    assert.ok(inserted, "Person should have been inserted into the DB");

    /* The person must be in the leader's school, NOT the foreign school */
    assert.equal(
      inserted.schoolId,
      leaderSchoolId,
      `Expected person.schoolId=${leaderSchoolId} (leader's school) but got ${inserted.schoolId}`,
    );

    assert.notEqual(
      inserted.schoolId,
      foreignSchoolId,
      `Person must NOT be inserted under the foreign schoolId=${foreignSchoolId}`,
    );
  });

  /* 3 ── Double-check: zero rows under the foreign school ──────────────── */

  test("3 — No test persons were inserted into the foreign school at any point", async () => {
    const leaked = await db
      .select({ employeeId: people.employeeId })
      .from(people)
      .where(
        and(
          inArray(people.employeeId, testPersonEmployeeIds),
          eq(people.schoolId, foreignSchoolId),
        ),
      );

    assert.equal(
      leaked.length,
      0,
      `Found ${leaked.length} test person(s) in the foreign school (id=${foreignSchoolId}): ` +
        leaked.map((r) => r.employeeId).join(", "),
    );
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
