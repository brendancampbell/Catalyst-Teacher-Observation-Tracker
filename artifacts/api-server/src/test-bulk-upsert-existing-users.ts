/**
 * Integration tests: POST /api/people/bulk — upsert assignments for existing users.
 *
 * Verifies the four behaviours added in the "bulk upload upserts assignments"
 * change:
 *   1. A CSV row for a person whose employeeId already exists → status "assigned"
 *      (old active assignment closed, new active assignment created).
 *   2. A CSV row for a person whose email already exists (different employeeId in
 *      the CSV) → still resolved to the existing person → "assigned".
 *   3. Uploading an identical row again (same role + school) → idempotent "skipped".
 *   4. A brand-new person still produces "created" (regression guard).
 *   5. Denormalized role/schoolId on the people record is updated when the
 *      assignment differs.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:bulk-upsert-existing-users
 *
 * Requires the dev server to be running (NODE_ENV=development) and accessible
 * on the port given by $PORT (default 8080).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { inArray, eq, and, isNull, not } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { people, schools, assignments } from "@workspace/db/schema";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

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

/* ── Helpers ──────────────────────────────────────────────────────────────── */

let testPersonEmployeeIds: string[] = [];

function makeEmployeeId(): string {
  const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
  return `TBUU${ts}`;
}

function makeEmail(tag: string): string {
  return `test.bulk.upsert.${tag}.${Date.now()}@example.com`;
}

async function cleanupAll() {
  if (testPersonEmployeeIds.length > 0) {
    await db.delete(people).where(inArray(people.employeeId, testPersonEmployeeIds));
    testPersonEmployeeIds = [];
  }
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("POST /api/people/bulk — upsert assignments for existing users", () => {
  let adminJar: Jar;
  let schoolAId: number;
  let schoolBId: number;
  let homeOfficeId: number;

  before(async () => {
    /* Login as U10 (NETWORK_ADMIN Brendan Campbell) */
    adminJar = await loginAs("U10");

    /* Resolve two distinct real schools and one Home Office school */
    const realSchools = await db
      .select({ id: schools.id, displayName: schools.displayName })
      .from(schools)
      .where(eq(schools.isHomeOffice, false))
      .limit(2);

    assert.ok(
      realSchools.length >= 2,
      "At least two non-Home-Office schools must exist in the DB",
    );

    const hoSchools = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, true))
      .limit(1);

    assert.ok(hoSchools.length >= 1, "At least one Home Office school must exist");

    schoolAId    = realSchools[0]!.id;
    schoolBId    = realSchools[1]!.id;
    homeOfficeId = hoSchools[0]!.id;
  });

  after(async () => {
    await cleanupAll();
    pool.end().catch(() => {});
  });

  /* ── 1. Existing person matched by employeeId → "assigned" ───────────── */

  test("1 — existing person (employeeId match) gets new assignment → status 'assigned'", async () => {
    const empId  = makeEmployeeId();
    const email  = makeEmail("t1");
    const today  = new Date().toISOString().slice(0, 10);
    testPersonEmployeeIds.push(empId);

    /* Seed: person in schoolA with COACH role */
    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 "UpsertT1",
      email,
      role:                     "COACH",
      schoolId:                 schoolAId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    await db.insert(assignments).values({
      userId:    empId,
      role:      "COACH",
      schoolId:  schoolAId,
      startDate: today,
      endDate:   null,
    });

    /* Act: bulk-upload same employeeId to schoolB as SCHOOL_LEADER */
    const res = await apiBulk([{
      employeeId: empId,
      firstName:  "Test",
      lastName:   "UpsertT1",
      email,
      role:       "SCHOOL_LEADER",
      school:     String(schoolBId),
    }], adminJar);

    assert.equal(res.status, 200, `HTTP status: ${JSON.stringify(res.body)}`);
    const body = res.body as { results: Array<{ status: string; reason?: string }> };
    assert.ok(Array.isArray(body.results) && body.results.length === 1);
    assert.equal(
      body.results[0]!.status,
      "assigned",
      `Expected "assigned", got "${body.results[0]!.status}" — reason: ${body.results[0]!.reason}`,
    );

    /* New active assignment is for schoolB / SCHOOL_LEADER */
    const [active] = await db
      .select({ role: assignments.role, schoolId: assignments.schoolId })
      .from(assignments)
      .where(and(eq(assignments.userId, empId), isNull(assignments.endDate)));

    assert.ok(active, "Expected one active assignment after upsert");
    assert.equal(active.role, "SCHOOL_LEADER", "Active assignment role must be SCHOOL_LEADER");
    assert.equal(active.schoolId, schoolBId, `Active assignment schoolId must be ${schoolBId}`);

    /* Old COACH/schoolA assignment is now closed (endDate set) */
    const closed = await db
      .select({ endDate: assignments.endDate })
      .from(assignments)
      .where(and(
        eq(assignments.userId, empId),
        eq(assignments.role, "COACH"),
        not(isNull(assignments.endDate)),
      ));

    assert.ok(closed.length > 0, "Old COACH assignment must have been closed (endDate set)");
  });

  /* ── 2. Existing person matched by email only → "assigned" ───────────── */

  test("2 — existing person matched by email (different employeeId in CSV) → 'assigned'", async () => {
    const empId       = makeEmployeeId();
    const csvEmpId    = makeEmployeeId(); /* what the CSV claims — does NOT match */
    const email       = makeEmail("t2");
    const today       = new Date().toISOString().slice(0, 10);
    testPersonEmployeeIds.push(empId); /* only the real ID needs cleanup */

    /* Seed person in schoolA */
    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 "UpsertT2",
      email,
      role:                     "COACH",
      schoolId:                 schoolAId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    await db.insert(assignments).values({
      userId:    empId,
      role:      "COACH",
      schoolId:  schoolAId,
      startDate: today,
      endDate:   null,
    });

    /* Act: CSV uses a different employeeId but same email */
    const res = await apiBulk([{
      employeeId: csvEmpId,
      firstName:  "Test",
      lastName:   "UpsertT2",
      email,
      role:       "SCHOOL_LEADER",
      school:     String(schoolBId),
    }], adminJar);

    assert.equal(res.status, 200, `HTTP status: ${JSON.stringify(res.body)}`);
    const body = res.body as { results: Array<{ status: string; reason?: string }> };
    assert.ok(Array.isArray(body.results) && body.results.length === 1);
    assert.equal(
      body.results[0]!.status,
      "assigned",
      `Expected "assigned" for email-matched person, got "${body.results[0]!.status}"`,
    );

    /* The assignment was written using the EXISTING person's employeeId */
    const [active] = await db
      .select({ role: assignments.role, schoolId: assignments.schoolId })
      .from(assignments)
      .where(and(eq(assignments.userId, empId), isNull(assignments.endDate)));

    assert.ok(active, "Active assignment must use the existing person's employeeId");
    assert.equal(active.role, "SCHOOL_LEADER");
    assert.equal(active.schoolId, schoolBId);

    /* No person was accidentally created for the CSV's fake employeeId */
    const phantom = await db
      .select({ employeeId: people.employeeId })
      .from(people)
      .where(eq(people.employeeId, csvEmpId));
    assert.equal(phantom.length, 0, "No new person should be created when email matches existing");
  });

  /* ── 3. Identical active assignment → idempotent "skipped" ───────────── */

  test("3 — uploading identical row twice → idempotent 'skipped'", async () => {
    const empId  = makeEmployeeId();
    const email  = makeEmail("t3");
    const today  = new Date().toISOString().slice(0, 10);
    testPersonEmployeeIds.push(empId);

    /* Seed person + active assignment */
    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 "UpsertT3",
      email,
      role:                     "COACH",
      schoolId:                 schoolAId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    await db.insert(assignments).values({
      userId:    empId,
      role:      "COACH",
      schoolId:  schoolAId,
      startDate: today,
      endDate:   null,
    });

    const csvRow = {
      employeeId: empId,
      firstName:  "Test",
      lastName:   "UpsertT3",
      email,
      role:       "COACH",
      school:     String(schoolAId),
    };

    /* First upload */
    const res1 = await apiBulk([csvRow], adminJar);
    assert.equal(res1.status, 200);
    const body1 = res1.body as { results: Array<{ status: string }> };
    assert.equal(
      body1.results[0]!.status,
      "skipped",
      `First upload with identical row should be "skipped", got "${body1.results[0]!.status}"`,
    );

    /* Second upload — still idempotent */
    const res2 = await apiBulk([csvRow], adminJar);
    const body2 = res2.body as { results: Array<{ status: string }> };
    assert.equal(body2.results[0]!.status, "skipped", "Second upload must also be skipped");

    /* Only one active assignment exists (not duplicated) */
    const allActive = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(and(eq(assignments.userId, empId), isNull(assignments.endDate)));

    assert.equal(allActive.length, 1, "Exactly one active assignment must exist after idempotent uploads");
  });

  /* ── 4. Brand-new person still returns "created" (regression guard) ──── */

  test("4 — brand-new person still returns 'created' (regression guard)", async () => {
    const empId = makeEmployeeId();
    const email = makeEmail("t4");
    testPersonEmployeeIds.push(empId);

    const res = await apiBulk([{
      employeeId: empId,
      firstName:  "Test",
      lastName:   "UpsertT4",
      email,
      role:       "COACH",
      school:     String(schoolAId),
    }], adminJar);

    assert.equal(res.status, 200, `HTTP status: ${JSON.stringify(res.body)}`);
    const body = res.body as { results: Array<{ status: string; reason?: string }> };
    assert.equal(
      body.results[0]!.status,
      "created",
      `Expected "created" for new person, got "${body.results[0]!.status}"`,
    );

    /* Person and active assignment exist in DB */
    const [person] = await db
      .select({ employeeId: people.employeeId })
      .from(people)
      .where(eq(people.employeeId, empId));
    assert.ok(person, "New person must exist in DB");

    const [active] = await db
      .select({ role: assignments.role })
      .from(assignments)
      .where(and(eq(assignments.userId, empId), isNull(assignments.endDate)));
    assert.ok(active, "New person must have an active assignment");
    assert.equal(active.role, "COACH");
  });

  /* ── 5. Denormalized fields on people row updated when assignment differs */

  test("5 — denormalized role and schoolId on people row are updated after upsert", async () => {
    const empId  = makeEmployeeId();
    const email  = makeEmail("t5");
    const today  = new Date().toISOString().slice(0, 10);
    testPersonEmployeeIds.push(empId);

    /* Seed person with COACH / schoolA */
    await db.insert(people).values({
      employeeId:               empId,
      firstName:                "Test",
      lastName:                 "UpsertT5",
      email,
      role:                     "COACH",
      schoolId:                 schoolAId,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    await db.insert(assignments).values({
      userId:    empId,
      role:      "COACH",
      schoolId:  schoolAId,
      startDate: today,
      endDate:   null,
    });

    /* Act: reassign to schoolB as SCHOOL_LEADER */
    const res = await apiBulk([{
      employeeId: empId,
      firstName:  "Test",
      lastName:   "UpsertT5",
      email,
      role:       "SCHOOL_LEADER",
      school:     String(schoolBId),
    }], adminJar);

    assert.equal(res.status, 200);
    const body = res.body as { results: Array<{ status: string }> };
    assert.equal(body.results[0]!.status, "assigned");

    /* people row should now reflect the new role and school */
    const [person] = await db
      .select({ role: people.role, schoolId: people.schoolId })
      .from(people)
      .where(eq(people.employeeId, empId));

    assert.ok(person, "Person must still exist in DB");
    assert.equal(person.role, "SCHOOL_LEADER", "Denormalized role must be updated to SCHOOL_LEADER");
    assert.equal(person.schoolId, schoolBId, `Denormalized schoolId must be updated to ${schoolBId}`);
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
