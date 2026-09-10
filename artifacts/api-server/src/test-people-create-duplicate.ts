/**
 * Integration tests: adding a person who already exists says who and where.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:people-create-duplicate
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * POST /api/people used to answer every duplicate with one catch-all line, so
 * an admin could not tell a typo from a deactivated teacher they could simply
 * turn back on. The message now depends on whether the caller manages the
 * existing person — and outside that reach it names the school, never the
 * person, which the cross-school test below holds it to.
 *
 *   1. School leader, active duplicate at own school   → names them, says active
 *   2. School leader, deactivated duplicate at own school → says reactivate
 *   3. School leader, duplicate at another school      → school name + support, no name
 *   4. Network admin, deactivated duplicate elsewhere  → names the school, says reactivate
 *   5. Network admin, active duplicate at another school → points at Reassign
 *   6. A genuinely new person is still created
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";
import { eq, inArray, asc, and, ne } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP       = Date.now();
const LEADER      = `TST_PCD_SL_${STAMP}`;
const ADMIN       = `TST_PCD_NA_${STAMP}`;
const ACTIVE_A    = `TST_PCD_ACTA_${STAMP}`;
const INACTIVE_A  = `TST_PCD_INAA_${STAMP}`;
const ACTIVE_B    = `TST_PCD_ACTB_${STAMP}`;
const INACTIVE_B  = `TST_PCD_INAB_${STAMP}`;
const NEW_PERSON  = `TST_PCD_NEW_${STAMP}`;
const ATTEMPT     = `TST_PCD_TRY_${STAMP}`;
const ALL_EIDS = [LEADER, ADMIN, ACTIVE_A, INACTIVE_A, ACTIVE_B, INACTIVE_B, NEW_PERSON, ATTEMPT];

const emailFor = (eid: string) => `${eid}@example.com`.toLowerCase();

type Jar = { cookieHeader: string };

async function request(method: string, path: string, body: unknown, jar: Jar) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: jar.cookieHeader },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: parsed as any };
}

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  return { cookieHeader: res.headers.get("set-cookie")!.split(";")[0]! };
}

const attempt = (employeeId: string, email: string, schoolId: number) => ({
  employeeId,
  email,
  firstName: "Pcd",
  lastName:  "Attempt",
  role:      "NO_ACCESS",
  schoolId,
  includeInFeedbackTracker: true,
});

async function rowsFor(employeeId: string) {
  return db.select({ employeeId: people.employeeId }).from(people).where(eq(people.employeeId, employeeId));
}

let leaderJar: Jar;
let adminJar:  Jar;
let schoolA: number;
let schoolB: number;
let schoolBName: string;

describe("Adding a person who already exists explains the match", () => {
  before(async () => {
    const [a] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(1);
    assert.ok(a, "Need a school");
    schoolA = a.id;

    const [b] = await db.select({ id: schools.id, name: schools.displayName }).from(schools)
      .where(and(eq(schools.isHomeOffice, false), ne(schools.id, schoolA)))
      .orderBy(asc(schools.id)).limit(1);
    assert.ok(b, "Need a second school");
    schoolB = b.id;
    schoolBName = b.name;

    const [ho] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, true)).limit(1);

    const person = (employeeId: string, lastName: string, role: "SCHOOL_LEADER" | "NETWORK_ADMIN" | "NO_ACCESS",
                    schoolId: number | null, isActive: boolean) => ({
      employeeId, firstName: "Pcd", lastName, email: emailFor(employeeId),
      role, schoolId, isActive, includeInFeedbackTracker: role === "NO_ACCESS",
    });

    await db.insert(people).values([
      person(LEADER,     "Leader",       "SCHOOL_LEADER", schoolA,       true),
      person(ADMIN,      "Admin",        "NETWORK_ADMIN", ho?.id ?? null, true),
      person(ACTIVE_A,   "ActiveHere",   "NO_ACCESS",     schoolA,       true),
      person(INACTIVE_A, "InactiveHere", "NO_ACCESS",     schoolA,       false),
      person(ACTIVE_B,   "Elsewhere",    "NO_ACCESS",     schoolB,       true),
      person(INACTIVE_B, "GoneElsewhere", "NO_ACCESS",    schoolB,       false),
    ]).onConflictDoNothing();

    leaderJar = await loginAs(LEADER);
    adminJar  = await loginAs(ADMIN);
  });

  after(async () => {
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — school leader re-adding an active teacher at their school is told they are already here", async () => {
    const res = await request("POST", "/people", attempt(ATTEMPT, emailFor(ACTIVE_A), schoolA), leaderJar);
    assert.equal(res.status, 409, `expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /ActiveHere/);
    assert.match(res.body.error, /active user at your school/);
    assert.equal((await rowsFor(ATTEMPT)).length, 0, "nothing should have been written");
  });

  test("2 — school leader re-adding a deactivated teacher at their school is told to reactivate", async () => {
    const res = await request("POST", "/people",
      attempt(INACTIVE_A, "someone-new@example.com", schoolA), leaderJar);
    assert.equal(res.status, 409, `expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /^Employee ID /);
    assert.match(res.body.error, /deactivated at your school/);
    assert.match(res.body.error, /Reactivate/);
  });

  test("3 — school leader hitting someone at another school gets the school and support, not the name", async () => {
    const res = await request("POST", "/people", attempt(ATTEMPT, emailFor(ACTIVE_B), schoolA), leaderJar);
    assert.equal(res.status, 409, `expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.error.includes(schoolBName), `should name ${schoolBName}: ${res.body.error}`);
    assert.match(res.body.error, /Contact Catalyst support/);
    assert.doesNotMatch(res.body.error, /Elsewhere/, "another school's person must not be named");
    assert.doesNotMatch(res.body.error, /Reactivate|active user/, "their status is not this school's business");
    assert.equal((await rowsFor(ATTEMPT)).length, 0, "nothing should have been written");
  });

  test("4 — network admin re-adding a deactivated person elsewhere is told the school and to reactivate", async () => {
    const res = await request("POST", "/people", attempt(ATTEMPT, emailFor(INACTIVE_B), schoolA), adminJar);
    assert.equal(res.status, 409, `expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.error.includes(schoolBName), `should name ${schoolBName}: ${res.body.error}`);
    assert.match(res.body.error, /GoneElsewhere/);
    assert.match(res.body.error, /deactivated/);
    assert.match(res.body.error, /Reactivate/);
  });

  test("5 — network admin adding an active person to a different school is pointed at Reassign", async () => {
    const res = await request("POST", "/people", attempt(ATTEMPT, emailFor(ACTIVE_B), schoolA), adminJar);
    assert.equal(res.status, 409, `expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /active user at /);
    assert.match(res.body.error, /Reassign/);
  });

  test("6 — a genuinely new person is still created", async () => {
    const res = await request("POST", "/people", attempt(NEW_PERSON, emailFor(NEW_PERSON), schoolA), leaderJar);
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal((await rowsFor(NEW_PERSON)).length, 1);
  });
});
