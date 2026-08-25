/**
 * Integration tests: a school leader can add a teacher (backlog #35).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:school-leader-create-teacher
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * A teacher is a person with the NO_ACCESS role and the observable flag set.
 * POST /api/people refused that role for a school leader, while editing,
 * activating and the bulk roster upload all allowed it — so a school leader
 * could upload a spreadsheet full of teachers but not add one by hand, which
 * made a mid-year arrival an administrator's job.
 *
 * The tests that matter most here are the ones proving what did NOT change.
 *
 *   1. A school leader can create a teacher in their own school
 *   2. The teacher is observable and appears in their people list
 *   3. A school leader still cannot create anybody in another school
 *   4. A school leader still cannot create a Network Leader
 *   5. A school leader still cannot create a Network Admin
 *   6. A coach still cannot create anybody at all
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";
import { eq, inArray, asc, and, ne } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP   = Date.now();
const LEADER  = `TST_SLCT_SL_${STAMP}`;
const COACH   = `TST_SLCT_CO_${STAMP}`;
const TEACHER = `TST_SLCT_TCH_${STAMP}`;
const FOREIGN = `TST_SLCT_FGN_${STAMP}`;
const NETLEAD = `TST_SLCT_NL_${STAMP}`;
const NETADM  = `TST_SLCT_NA_${STAMP}`;
const BYCOACH = `TST_SLCT_BC_${STAMP}`;
const ALL_EIDS = [LEADER, COACH, TEACHER, FOREIGN, NETLEAD, NETADM, BYCOACH];

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

const newPerson = (employeeId: string, role: string, schoolId: number, observable = false) => ({
  employeeId,
  firstName: "Slct",
  lastName:  employeeId.slice(-6),
  email:     `${employeeId}@example.com`.toLowerCase(),
  role,
  schoolId,
  includeInFeedbackTracker: observable,
});

let leaderJar: Jar;
let coachJar:  Jar;
let schoolId:      number;
let otherSchoolId: number;
let homeOfficeId:  number | null = null;

describe("A school leader can add a teacher", () => {
  before(async () => {
    const [school] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(1);
    assert.ok(school, "Need a school");
    schoolId = school.id;

    const [other] = await db.select({ id: schools.id }).from(schools)
      .where(and(eq(schools.isHomeOffice, false), ne(schools.id, schoolId)))
      .orderBy(asc(schools.id)).limit(1);
    assert.ok(other, "Need a second school");
    otherSchoolId = other.id;

    const [ho] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, true)).limit(1);
    homeOfficeId = ho?.id ?? null;

    await db.insert(people).values([
      { employeeId: LEADER, firstName: "Slct", lastName: "Leader", email: `${LEADER}@example.com`.toLowerCase(),
        role: "SCHOOL_LEADER", schoolId, isActive: true, includeInFeedbackTracker: false },
      { employeeId: COACH, firstName: "Slct", lastName: "Coach", email: `${COACH}@example.com`.toLowerCase(),
        role: "COACH", schoolId, isActive: true, includeInFeedbackTracker: false },
    ]).onConflictDoNothing();

    leaderJar = await loginAs(LEADER);
    coachJar  = await loginAs(COACH);
  });

  after(async () => {
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — a school leader can create a teacher in their own school", async () => {
    const res = await request("POST", "/people",
      newPerson(TEACHER, "NO_ACCESS", schoolId, true), leaderJar);
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.role, "NO_ACCESS");
    assert.equal(res.body.schoolId, schoolId);
  });

  test("2 — the teacher is observable and lands in their people list", async () => {
    const [row] = await db.select({
      observable: people.includeInFeedbackTracker,
      schoolId:   people.schoolId,
      isActive:   people.isActive,
    }).from(people).where(eq(people.employeeId, TEACHER)).limit(1);
    assert.ok(row, "the teacher should exist");
    assert.equal(row.observable, true, "a teacher has to be observable to be any use");
    assert.equal(row.schoolId, schoolId);

    const list = await request("GET", "/people", undefined, leaderJar);
    assert.equal(list.status, 200);
    const found = (list.body as Array<{ employeeId: string }>).some((p) => p.employeeId === TEACHER);
    assert.ok(found, "the leader should see the teacher they just created");
  });

  /* ── What must NOT have changed ─────────────────────────────────── */

  test("3 — a school leader still cannot create anybody in another school", async () => {
    const res = await request("POST", "/people",
      newPerson(FOREIGN, "NO_ACCESS", otherSchoolId, true), leaderJar);
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);

    const rows = await db.select().from(people).where(eq(people.employeeId, FOREIGN));
    assert.equal(rows.length, 0, "nothing should have been written");
  });

  test("4 — a school leader still cannot create a Network Leader", async () => {
    const res = await request("POST", "/people",
      newPerson(NETLEAD, "NETWORK_LEADER", homeOfficeId ?? schoolId), leaderJar);
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);

    const rows = await db.select().from(people).where(eq(people.employeeId, NETLEAD));
    assert.equal(rows.length, 0, "nothing should have been written");
  });

  test("5 — a school leader still cannot create a Network Admin", async () => {
    const res = await request("POST", "/people",
      newPerson(NETADM, "NETWORK_ADMIN", homeOfficeId ?? schoolId), leaderJar);
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);

    const rows = await db.select().from(people).where(eq(people.employeeId, NETADM));
    assert.equal(rows.length, 0, "nothing should have been written");
  });

  test("6 — a coach still cannot create anybody", async () => {
    const res = await request("POST", "/people",
      newPerson(BYCOACH, "NO_ACCESS", schoolId, true), coachJar);
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);

    const rows = await db.select().from(people).where(eq(people.employeeId, BYCOACH));
    assert.equal(rows.length, 0, "nothing should have been written");
  });
});
