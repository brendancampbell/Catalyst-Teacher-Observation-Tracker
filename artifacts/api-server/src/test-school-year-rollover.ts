/**
 * Integration tests for the staged school-year rollover.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-school-year-rollover.ts
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * ── Why the fixture mirrors the whole roster ──────────────────────────────
 * Activating a year deactivates everyone who holds an open assignment in the
 * outgoing year and none in the incoming one. Against a shared development
 * database a naive fixture would therefore deactivate every real person the
 * moment it flipped years. So setup copies every open assignment from the
 * active year into the scratch year first, and then deliberately withholds
 * exactly one person (LEAVE). Departures are then provably {LEAVE} and the
 * blast radius is one row.
 *
 * Scenarios:
 *   1. Activation refuses a year with no roster
 *   2. An admin's absence from the roster is never a blocker
 *   3. Activation refuses a year with no active rubric set
 *   4. Dry run reports new hires, school moves and departures, and writes nothing
 *   5. Staged upload writes assignments but touches no person-level field
 *   6. A staged new hire is created inert (isActive false)
 *   7. Activation deactivates the departed, activates the new hire, applies the
 *      move — and leaves the admin active despite never being on the roster
 *   8. Rolling back restores the departed person and their school
 *   9. An empty incoming year yields no departures — but a pending roster
 *      into an empty year still does
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, rubricSets, schoolYears, schools, assignments } from "@workspace/db/schema";
import { eq, and, ne, asc, inArray, isNull } from "drizzle-orm";
import { computeDepartures, loadSchoolLookup } from "./lib/roster";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const ADM_EID   = "TST_ROLL_ADM";
const STAY_EID  = "TST_ROLL_STAY";
const MOVE_EID  = "TST_ROLL_MOVE";
const LEAVE_EID = "TST_ROLL_LEAVE";
const NEW_EID   = "TST_ROLL_NEW";
const ALL_EIDS  = [ADM_EID, STAY_EID, MOVE_EID, LEAVE_EID, NEW_EID];

type Jar = { cookieHeader: string };

async function request(
  method: string,
  path: string,
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar.cookieHeader) headers["Cookie"] = jar.cookieHeader;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  return { cookieHeader: setCookie!.split(";")[0]! };
}

async function personRow(employeeId: string) {
  const [row] = await db.select({
    isActive: people.isActive,
    schoolId: people.schoolId,
    role:     people.role,
  }).from(people).where(eq(people.employeeId, employeeId)).limit(1);
  return row ?? null;
}

let jar: Jar;
let originalYearId: number;
let scratchYearId: number;
let hoSchoolId: number;
let schoolAId: number;
let schoolBId: number;
let schoolAName: string;
let schoolBName: string;

describe("Staged school-year rollover", () => {
  before(async () => {
    const [ho] = await db.select({ id: schools.id, displayName: schools.displayName })
      .from(schools).where(eq(schools.isHomeOffice, true)).limit(1);
    assert.ok(ho, "Need a Home Office school");
    hoSchoolId = ho.id;

    const realSchools = await db.select({ id: schools.id, displayName: schools.displayName })
      .from(schools)
      .where(and(eq(schools.isHomeOffice, false), eq(schools.isActive, true)))
      .orderBy(asc(schools.id))
      .limit(2);
    assert.equal(realSchools.length, 2, "Need two non-home-office schools");
    schoolAId = realSchools[0]!.id;
    schoolBId = realSchools[1]!.id;
    schoolAName = realSchools[0]!.displayName;
    schoolBName = realSchools[1]!.displayName;

    const [activeYear] = await db.select().from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(activeYear, "Need an active school year");
    originalYearId = activeYear.id;

    /* Scratch year to roll into */
    const [scratch] = await db.insert(schoolYears).values({
      name:         `TST Rollover ${Date.now()}`,
      status:       "inactive",
      displayOrder: 9999,
    }).returning({ id: schoolYears.id });
    scratchYearId = scratch!.id;

    /* Test people, all present in the ORIGINAL year */
    await db.insert(people).values([
      { employeeId: ADM_EID,   firstName: "Test", lastName: "RollAdm",   email: "tst.roll.adm@example.com",   role: "NETWORK_ADMIN", schoolId: hoSchoolId, isActive: true, includeInFeedbackTracker: false },
      { employeeId: STAY_EID,  firstName: "Test", lastName: "RollStay",  email: "tst.roll.stay@example.com",  role: "COACH",         schoolId: schoolAId,  isActive: true, includeInFeedbackTracker: false },
      { employeeId: MOVE_EID,  firstName: "Test", lastName: "RollMove",  email: "tst.roll.move@example.com",  role: "COACH",         schoolId: schoolAId,  isActive: true, includeInFeedbackTracker: false },
      { employeeId: LEAVE_EID, firstName: "Test", lastName: "RollLeave", email: "tst.roll.leave@example.com", role: "COACH",         schoolId: schoolAId,  isActive: true, includeInFeedbackTracker: false },
    ]).onConflictDoNothing();

    await db.insert(assignments).values([
      { userId: ADM_EID,   role: "NETWORK_ADMIN", schoolId: hoSchoolId, schoolYearId: originalYearId, startDate: "2025-08-01", endDate: null },
      { userId: STAY_EID,  role: "COACH",         schoolId: schoolAId,  schoolYearId: originalYearId, startDate: "2025-08-01", endDate: null },
      { userId: MOVE_EID,  role: "COACH",         schoolId: schoolAId,  schoolYearId: originalYearId, startDate: "2025-08-01", endDate: null },
      { userId: LEAVE_EID, role: "COACH",         schoolId: schoolAId,  schoolYearId: originalYearId, startDate: "2025-08-01", endDate: null },
    ]).onConflictDoNothing();

    jar = await loginAs(ADM_EID);
  });

  after(async () => {
    /* Restore the original year first, while the admin still has an
       assignment in it — the gate is enforced on the way back too. */
    await request("POST", `/admin/school-years/${originalYearId}/activate`, {}, jar).catch(() => {});

    await db.delete(assignments).where(eq(assignments.schoolYearId, scratchYearId)).catch(() => {});
    await db.delete(assignments).where(inArray(assignments.userId, ALL_EIDS)).catch(() => {});
    await db.delete(rubricSets).where(eq(rubricSets.schoolYearId, scratchYearId)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await db.delete(schoolYears).where(eq(schoolYears.id, scratchYearId)).catch(() => {});
  });

  /* ── Gate ───────────────────────────────────────────────────────────── */

  test("1 — activation refuses a year with no roster", async () => {
    const r = await request("POST", `/admin/school-years/${scratchYearId}/activate`, {}, jar);
    assert.equal(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, "NOT_READY_TO_ACTIVATE");
    assert.equal(r.body.hasRoster, false, "hasRoster must be false for an empty year");
    assert.ok(
      r.body.blockers.some((b: string) => b.includes("roster")),
      `blockers should name the missing roster: ${JSON.stringify(r.body.blockers)}`,
    );
  });

  test("2 — an admin's absence from the roster is never a blocker", async () => {
    /* Mirror the active year's roster into the scratch year, withholding
       LEAVE (the departure under test), MOVE (whose new school the roster
       upload will set), and ADM — who is never added back, for the rest of
       this file. Admins administer years; they are not rostered for them. */
    await pool.query(
      `INSERT INTO assignments (user_id, role, school_id, school_year_id, start_date, end_date)
       SELECT user_id, role, school_id, $1, start_date, NULL
         FROM assignments
        WHERE school_year_id = $2 AND end_date IS NULL
          AND user_id <> ALL($3::text[])
       ON CONFLICT DO NOTHING`,
      [scratchYearId, originalYearId, [LEAVE_EID, MOVE_EID, ADM_EID]],
    );

    const r = await request("POST", `/admin/school-years/${scratchYearId}/activate`, {}, jar);
    assert.equal(r.status, 409, `Expected 409 (still no rubric set), got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.hasRoster, true, "the year now has a roster");
    assert.equal(r.body.hasRubricSet, false, "…but still no rubric set");
    assert.ok(
      !r.body.blockers.some((b: string) => /assignment in this year/i.test(b)),
      `the admin's own absence must not be a blocker: ${JSON.stringify(r.body.blockers)}`,
    );
  });

  test("3 — activation refuses a year with no active rubric set", async () => {
    const r = await request("POST", `/admin/school-years/${scratchYearId}/activate`, {}, jar);
    assert.equal(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.hasRubricSet, false);

    /* Satisfy the last precondition for the tests that follow */
    await db.insert(rubricSets).values({
      slug:         `tst-roll-${Date.now()}`,
      name:         "Test Rollover Rubric",
      schoolYearId: scratchYearId,
      isActive:     true,
      isArchived:   false,
      target:       "TEACHER",
    });

    const readiness = await request("GET", `/admin/school-years/${scratchYearId}/readiness`, undefined, jar);
    assert.equal(
      readiness.body.ready, true,
      `year should be ready even though the admin is not on its roster: ${JSON.stringify(readiness.body)}`,
    );
  });

  /* ── Dry run ────────────────────────────────────────────────────────── */

  const rosterRows = () => [
    { firstName: "Test", lastName: "RollStay", employeeId: STAY_EID, email: "tst.roll.stay@example.com", role: "COACH", school: schoolAName },
    { firstName: "Test", lastName: "RollMove", employeeId: MOVE_EID, email: "tst.roll.move@example.com", role: "COACH", school: schoolBName },
    { firstName: "Test", lastName: "RollNew",  employeeId: NEW_EID,  email: "tst.roll.new@example.com",  role: "COACH", school: schoolAName },
    /* Deliberately no admin row — admins are not rostered. */
  ];

  test("4 — dry run reports the diff and writes nothing", async () => {
    const r = await request("POST", "/people/bulk", {
      rows: rosterRows(), schoolYearId: scratchYearId, dryRun: true,
    }, jar);
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.dryRun, true);
    assert.equal(r.body.staged, true, "targeting a non-active year is a staged upload");
    assert.equal(r.body.counts.newHires, 1, "NEW is the only person who does not exist yet");
    assert.equal(r.body.counts.schoolMoves, 1, "MOVE changes school");
    assert.equal(r.body.counts.departures, 1, "LEAVE is the only person withheld from the scratch year");
    assert.equal(
      r.body.departures[0].employeeId, LEAVE_EID,
      `departure should be ${LEAVE_EID}: ${JSON.stringify(r.body.departures)}`,
    );
    assert.ok(
      !r.body.departures.some((d: { employeeId: string }) => d.employeeId === ADM_EID),
      "an admin absent from the roster must never be reported as departing",
    );

    /* Nothing was written */
    const created = await personRow(NEW_EID);
    assert.equal(created, null, "dry run must not create the new hire");
    const move = await personRow(MOVE_EID);
    assert.equal(move?.schoolId, schoolAId, "dry run must not move anyone");
  });

  /* ── Staged write ───────────────────────────────────────────────────── */

  test("5 — staged upload writes assignments but no person-level field", async () => {
    const r = await request("POST", "/people/bulk", {
      rows: rosterRows(), schoolYearId: scratchYearId,
    }, jar);
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.staged, true);

    const [moveStaged] = await db.select({ schoolId: assignments.schoolId })
      .from(assignments)
      .where(and(
        eq(assignments.userId, MOVE_EID),
        eq(assignments.schoolYearId, scratchYearId),
        isNull(assignments.endDate),
      )).limit(1);
    assert.equal(moveStaged?.schoolId, schoolBId, "staged assignment should be at the new school");

    /* The active year is untouched */
    const move = await personRow(MOVE_EID);
    assert.equal(move?.schoolId, schoolAId, "person record must not move until the flip");
    const leave = await personRow(LEAVE_EID);
    assert.equal(leave?.isActive, true, "nobody is deactivated until the flip");
  });

  test("6 — a staged new hire is created inert", async () => {
    const created = await personRow(NEW_EID);
    assert.ok(created, "the person row must exist — assignments.user_id is a foreign key");
    assert.equal(created.isActive, false, "a staged hire must not be able to sign in before the flip");
  });

  /* ── The flip ───────────────────────────────────────────────────────── */

  test("7 — activation deactivates the departed, activates the hire, applies the move", async () => {
    const r = await request("POST", `/admin/school-years/${scratchYearId}/activate`, {}, jar);
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);

    const leave = await personRow(LEAVE_EID);
    assert.equal(leave?.isActive, false, "someone absent from the new roster is deactivated");

    const hire = await personRow(NEW_EID);
    assert.equal(hire?.isActive, true, "the staged hire becomes active at the flip");

    const move = await personRow(MOVE_EID);
    assert.equal(move?.schoolId, schoolBId, "the denormalised school follows the new year's assignment");

    const stay = await personRow(STAY_EID);
    assert.equal(stay?.isActive, true, "someone on both rosters is untouched");
    assert.equal(stay?.schoolId, schoolAId);

    /* The point of the exercise: the admin was never on this year's roster
       and is still active, and still able to use the API. */
    const admin = await personRow(ADM_EID);
    assert.equal(admin?.isActive, true, "an admin must never be deactivated for being off a roster");
    const stillWorks = await request("GET", "/admin/school-years", undefined, jar);
    assert.equal(stillWorks.status, 200, "the admin must retain access in the year they just activated");

    /* The departure's outgoing assignment is closed, not deleted */
    const [closed] = await db.select({ endDate: assignments.endDate })
      .from(assignments)
      .where(and(
        eq(assignments.userId, LEAVE_EID),
        eq(assignments.schoolYearId, originalYearId),
      )).limit(1);
    assert.ok(closed?.endDate, "the departure's ledger row should be end-dated");
  });

  /* ── Rollback ───────────────────────────────────────────────────────── */

  test("8 — rolling back restores the departed person and their school", async () => {
    const r = await request("POST", `/admin/school-years/${originalYearId}/activate`, {}, jar);
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);

    const leave = await personRow(LEAVE_EID);
    assert.equal(leave?.isActive, true, "rolling back reactivates whoever the flip deactivated");

    const [reopened] = await db.select({ endDate: assignments.endDate })
      .from(assignments)
      .where(and(
        eq(assignments.userId, LEAVE_EID),
        eq(assignments.schoolYearId, originalYearId),
      )).limit(1);
    assert.equal(reopened?.endDate, null, "their ledger row is reopened");

    const move = await personRow(MOVE_EID);
    assert.equal(move?.schoolId, schoolAId, "the school move is undone by the rollback");

    const [active] = await db.select({ id: schoolYears.id })
      .from(schoolYears).where(eq(schoolYears.status, "active")).limit(1);
    assert.equal(active?.id, originalYearId, "the original year is active again");

    const others = await db.select({ id: schoolYears.id })
      .from(schoolYears)
      .where(and(eq(schoolYears.status, "active"), ne(schoolYears.id, originalYearId)));
    assert.equal(others.length, 0, "exactly one year is ever active");
  });

  /* ── The empty-year rule ────────────────────────────────────────────── */

  test("9 — an empty incoming year yields no departures, a pending roster does", async () => {
    /*
     * Exercised directly rather than through the API because the activation
     * gate refuses an empty year, so the flip can never reach this state
     * today. That is exactly why it is worth a test: the guard exists so the
     * behaviour is safe if the gate is ever relaxed, and a guard nothing
     * checks is a guard that quietly stops working.
     */
    const [empty] = await db.insert(schoolYears).values({
      name:         `TST Empty ${Date.now()}`,
      status:       "inactive",
      displayOrder: 9997,
    }).returning({ id: schoolYears.id });

    try {
      const lookup = await loadSchoolLookup();

      const noStatement = await computeDepartures({
        targetYearId:   empty!.id,
        outgoingYearId: originalYearId,
        lookup,
        alsoAssigned:   new Set<string>(),
      });
      assert.equal(
        noStatement.length, 0,
        "a year that says nothing about anyone must not be read as everyone having left",
      );

      /* A pending upload is a statement, even into a year with nothing in it. */
      const withUpload = await computeDepartures({
        targetYearId:   empty!.id,
        outgoingYearId: originalYearId,
        lookup,
        alsoAssigned:   new Set([STAY_EID]),
      });
      assert.ok(
        withUpload.length > 0,
        "a first roster into an empty year must still identify who is absent from it",
      );
      assert.ok(
        !withUpload.some((d) => d.employeeId === STAY_EID),
        "someone present in the pending upload is not a departure",
      );
      assert.ok(
        withUpload.some((d) => d.employeeId === LEAVE_EID),
        `${LEAVE_EID} is absent from the pending upload and should be departing`,
      );
    } finally {
      await db.delete(assignments).where(eq(assignments.schoolYearId, empty!.id)).catch(() => {});
      await db.delete(schoolYears).where(eq(schoolYears.id, empty!.id)).catch(() => {});
    }
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
