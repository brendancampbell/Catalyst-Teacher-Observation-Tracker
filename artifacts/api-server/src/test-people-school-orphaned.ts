/**
 * Integration tests: GET /api/people returns schoolOrphaned: true on rows
 * where schoolId is non-null but the school row no longer exists.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:people-school-orphaned
 *
 * Requires the dev server to be running (NODE_ENV=development).
 *
 * Scenarios:
 *   1. Person whose schoolId points to a deleted school → schoolOrphaned: true
 *   2. Person with a valid school assignment → schoolOrphaned: false
 *   3. Person with schoolId null → schoolOrphaned: false
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
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

async function apiGet(path: string, jar: Jar): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Cookie": jar.cookieHeader },
  });
  let responseBody: unknown;
  try { responseBody = await res.json(); } catch { responseBody = null; }
  return { status: res.status, body: responseBody };
}

/* ── Cleanup registry ─────────────────────────────────────────────────────── */

let testPersonEmployeeIds: string[] = [];

function makeId(prefix = "TPSO"): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 100_000)}`;
}

async function cleanup() {
  if (testPersonEmployeeIds.length > 0) {
    await db.delete(people).where(inArray(people.employeeId, testPersonEmployeeIds));
    testPersonEmployeeIds = [];
  }
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("GET /api/people — schoolOrphaned flag", () => {
  let naJar: Jar;
  let naEmployeeId: string;
  let hoSchoolId: number;
  let realSchoolId: number;

  before(async () => {
    /* Locate the Home Office school (required for NETWORK_ADMIN) */
    const [hoRow] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, true))
      .limit(1);
    assert.ok(hoRow, "A Home Office school must exist in the DB");
    hoSchoolId = hoRow.id;

    /* Locate a real (non-Home-Office) school */
    const [realRow] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, false))
      .limit(1);
    assert.ok(realRow, "At least one real school must exist in the DB");
    realSchoolId = realRow.id;

    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);

    /* Create a NETWORK_ADMIN (required to see all people) */
    naEmployeeId = makeId("TPSO_NA");
    await db.insert(people).values({
      employeeId:               naEmployeeId,
      firstName:                "Test",
      lastName:                 `NA${ts}`,
      email:                    `test.pso.na.${ts}@example.com`,
      role:                     "NETWORK_ADMIN",
      schoolId:                 hoSchoolId,
      isActive:                 true,
      includeInFeedbackTracker: false,
    });
    testPersonEmployeeIds.push(naEmployeeId);

    naJar = await loginAs(naEmployeeId);
  });

  after(cleanup);

  /* 1 ── Person whose schoolId points to a non-existent school ───────── */

  test("1 — person with orphaned schoolId → schoolOrphaned: true", async () => {
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    const personEid = makeId("TPSO_P1");

    /* Insert the person initially with a valid school */
    await db.insert(people).values({
      employeeId:               personEid,
      firstName:                "Orphan",
      lastName:                 `Person${ts}`,
      email:                    `orphan.${ts}@example.com`,
      role:                     "COACH",
      schoolId:                 realSchoolId,
      isActive:                 true,
      includeInFeedbackTracker: false,
    });
    testPersonEmployeeIds.push(personEid);

    /* Bypass the FK constraint (ON DELETE SET NULL prevents a direct delete)
       by using session_replication_role = 'replica', then set school_id to a
       value that has no matching row in schools.                             */
    await db.execute(sql`SET session_replication_role = 'replica'`);
    try {
      await db.execute(
        sql`UPDATE people SET school_id = 999999999 WHERE employee_id = ${personEid}`,
      );
    } finally {
      await db.execute(sql`SET session_replication_role = 'origin'`);
    }

    /* Fetch all people as NETWORK_ADMIN */
    const { status, body } = await apiGet("/people?includeInactive=true", naJar);
    assert.equal(status, 200, `Expected 200, got ${status}`);

    const rows = body as Array<{ employeeId: string; schoolOrphaned?: boolean }>;
    const orphanRow = rows.find((r) => r.employeeId === personEid);
    assert.ok(orphanRow, "The orphaned person should appear in the list");
    assert.equal(
      orphanRow.schoolOrphaned,
      true,
      `Expected schoolOrphaned: true, got: ${orphanRow.schoolOrphaned}`,
    );
  });

  /* 2 ── Person with a valid school assignment ─────────────────────────── */

  test("2 — person with valid school → schoolOrphaned: false", async () => {
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    const personEid = makeId("TPSO_P2");
    await db.insert(people).values({
      employeeId:               personEid,
      firstName:                "Valid",
      lastName:                 `Person${ts}`,
      email:                    `valid.${ts}@example.com`,
      role:                     "COACH",
      schoolId:                 realSchoolId,
      isActive:                 true,
      includeInFeedbackTracker: false,
    });
    testPersonEmployeeIds.push(personEid);

    const { status, body } = await apiGet("/people?includeInactive=true", naJar);
    assert.equal(status, 200, `Expected 200, got ${status}`);

    const rows = body as Array<{ employeeId: string; schoolOrphaned?: boolean }>;
    const validRow = rows.find((r) => r.employeeId === personEid);
    assert.ok(validRow, "The valid person should appear in the list");
    assert.equal(
      validRow.schoolOrphaned,
      false,
      `Expected schoolOrphaned: false, got: ${validRow.schoolOrphaned}`,
    );
  });

  /* 3 ── Person with schoolId null ────────────────────────────────────── */

  test("3 — person with null schoolId → schoolOrphaned: false", async () => {
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
    const personEid = makeId("TPSO_P3");
    await db.insert(people).values({
      employeeId:               personEid,
      firstName:                "NoSchool",
      lastName:                 `Person${ts}`,
      email:                    `noschool.${ts}@example.com`,
      role:                     "NO_ACCESS",
      schoolId:                 null,
      isActive:                 true,
      includeInFeedbackTracker: false,
    });
    testPersonEmployeeIds.push(personEid);

    const { status, body } = await apiGet("/people?includeInactive=true", naJar);
    assert.equal(status, 200, `Expected 200, got ${status}`);

    const rows = body as Array<{ employeeId: string; schoolOrphaned?: boolean }>;
    const nullRow = rows.find((r) => r.employeeId === personEid);
    assert.ok(nullRow, "The null-school person should appear in the list");
    assert.equal(
      nullRow.schoolOrphaned,
      false,
      `Expected schoolOrphaned: false, got: ${nullRow.schoolOrphaned}`,
    );
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
