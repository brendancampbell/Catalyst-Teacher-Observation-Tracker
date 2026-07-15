/**
 * Integration tests: SCHOOL_LEADER cannot promote staff to network-level roles
 * via POST /api/people/bulk.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:bulk-people-role-escalation
 *
 * Requires the dev server to be running (NODE_ENV=development) because it uses
 * the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   1. SCHOOL_LEADER bulk-imports a person with role=NETWORK_LEADER → row status "error"
 *   2. SCHOOL_LEADER bulk-imports a person with role=NETWORK_ADMIN  → row status "error"
 *   3. SCHOOL_LEADER bulk-imports a person with role=COACH          → row status "created"
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { inArray, eq } from "drizzle-orm";
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

/* ── Cleanup registry ─────────────────────────────────────────────────────── */

let testPersonEmployeeIds: string[] = [];

function makeEmployeeId(): string {
  const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
  return `TBRE${ts}`;
}

async function cleanup() {
  if (testPersonEmployeeIds.length > 0) {
    await db.delete(people).where(inArray(people.employeeId, testPersonEmployeeIds));
    testPersonEmployeeIds = [];
  }
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("POST /api/people/bulk — SCHOOL_LEADER role escalation guard", () => {
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
      lastName:                 `BulkSL${ts}`,
      email:                    `test.bulk.sl.${ts}@example.com`,
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

  /* 1 ── SCHOOL_LEADER → NETWORK_LEADER import → row error ─────────────── */

  test("1 — SCHOOL_LEADER bulk-imports role=NETWORK_LEADER → row status 'error'", async () => {
    const empId = makeEmployeeId();
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);

    const res = await apiBulk([
      {
        employeeId: empId,
        firstName: "Test",
        lastName: `BRE1${ts}`,
        email: `test.bre1.${ts}@example.com`,
        role: "NETWORK_LEADER",
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
    assert.equal(
      row.status,
      "error",
      `Expected row status "error", got "${row.status}". reason: ${row.reason}`,
    );
    assert.ok(
      typeof row.reason === "string" && /network/i.test(row.reason),
      `Expected reason to reference the network-role authorization guard. Got: "${row.reason}"`,
    );

    /* Confirm nothing was inserted */
    const inserted = await db.select({ employeeId: people.employeeId })
      .from(people)
      .where(eq(people.employeeId, empId));
    assert.equal(inserted.length, 0, "Person should not have been inserted into the DB");
  });

  /* 2 ── SCHOOL_LEADER → NETWORK_ADMIN import → row error ──────────────── */

  test("2 — SCHOOL_LEADER bulk-imports role=NETWORK_ADMIN → row status 'error'", async () => {
    const empId = makeEmployeeId();
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);

    const res = await apiBulk([
      {
        employeeId: empId,
        firstName: "Test",
        lastName: `BRE2${ts}`,
        email: `test.bre2.${ts}@example.com`,
        role: "NETWORK_ADMIN",
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
    assert.equal(
      row.status,
      "error",
      `Expected row status "error", got "${row.status}". reason: ${row.reason}`,
    );
    assert.ok(
      typeof row.reason === "string" && /network/i.test(row.reason),
      `Expected reason to reference the network-role authorization guard. Got: "${row.reason}"`,
    );

    /* Confirm nothing was inserted */
    const inserted = await db.select({ employeeId: people.employeeId })
      .from(people)
      .where(eq(people.employeeId, empId));
    assert.equal(inserted.length, 0, "Person should not have been inserted into the DB");
  });

  /* 3 ── SCHOOL_LEADER → COACH import → row created ────────────────────── */

  test("3 — SCHOOL_LEADER bulk-imports role=COACH → row status 'created'", async () => {
    const empId = makeEmployeeId();
    testPersonEmployeeIds.push(empId);
    const ts = Date.now() + Math.floor(Math.random() * 1_000_000);

    const res = await apiBulk([
      {
        employeeId: empId,
        firstName: "Test",
        lastName: `BRE3${ts}`,
        email: `test.bre3.${ts}@example.com`,
        role: "COACH",
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
    assert.equal(
      row.status,
      "created",
      `Expected row status "created", got "${row.status}". reason: ${row.reason}`,
    );
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
