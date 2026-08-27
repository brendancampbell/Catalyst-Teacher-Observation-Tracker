/**
 * Integration tests: the configurable rescore and overdue windows.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:system-settings
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * Both deadlines were hardcoded at 14 days in six places. They are now one
 * network-wide row, and changing the rescore window recalculates every queued
 * teacher's deadline from the walkthrough that flagged them.
 *
 *   1. Defaults are 14 days for both, so nothing changed on deploy
 *   2. A new walkthrough uses the configured window, not 14
 *   3. Changing the window recalculates existing queue entries
 *   4. Recalculation measures from the walkthrough, so changes do not compound
 *   5. The preview reports what a change would do before it is made
 *   6. Only network admins may write; anyone signed in may read
 *   7. Values outside the offered options are refused
 *   8. Setting a control to what it already says changes nothing
 *   9. The two windows are independent
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  people, schools, schoolYears, observations,
  rubricSets, rubricCategories, rubricDomains,
} from "@workspace/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP     = Date.now();
const ADMIN_EID = "U10";
const LEADER    = `TST_SS_SL_${STAMP}`;
const TEACHER   = `TST_SS_TCH_${STAMP}`;
const ALL_EIDS  = [LEADER, TEACHER];
const BELOW     = 0.5;   /* under the 0.7 proficiency threshold */

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

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);

async function teacherRow() {
  const [p] = await db.select({
    needsRescore: people.needsRescore,
    dueDate:      people.rescoreDueDate,
    fromDate:     people.rescoreFromDate,
  }).from(people).where(eq(people.employeeId, TEACHER)).limit(1);
  return p!;
}

/** Publish a walkthrough below proficiency, flagging the teacher. */
async function walkthroughOn(date: string, jar: Jar) {
  const res = await request("POST", "/observations", {
    teacherId: TEACHER, rubricSetId, date, scores: { [domainSlug]: BELOW },
    strengths: "s", growthAreas: "g", isWalkthrough: true, status: "published",
  }, jar);
  assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
  return Number(res.body.id);
}

let adminJar: Jar;
let leaderJar: Jar;
let schoolId: number;
let yearId: number;
let rubricSetId: number;
let domainSlug: string;

describe("Configurable rescore and overdue windows", () => {
  before(async () => {
    const [school] = await db.select({ id: schools.id }).from(schools)
      .where(eq(schools.isHomeOffice, false)).orderBy(asc(schools.id)).limit(1);
    assert.ok(school, "Need a school");
    schoolId = school.id;

    const [year] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");
    yearId = year.id;

    const [rs] = await db.insert(rubricSets)
      .values({ slug: `tst-ss-rs-${STAMP}`, name: "Settings RS",
                target: "TEACHER", isActive: true, schoolYearId: yearId })
      .returning({ id: rubricSets.id });
    assert.ok(rs);
    rubricSetId = rs.id;

    const [cat] = await db.insert(rubricCategories)
      .values({ rubricSetId: rs.id, name: "SS Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat);

    const [dom] = await db.insert(rubricDomains)
      .values({ categoryId: cat.id, rubricSetId: rs.id, schoolYearId: yearId,
                slug: `tst-ss-dom-${STAMP}`, name: "SS Domain", displayOrder: 1 })
      .returning({ slug: rubricDomains.slug });
    assert.ok(dom);
    domainSlug = dom.slug;

    await db.insert(people).values([
      { employeeId: TEACHER, firstName: "Ss", lastName: "Teacher",
        email: `${TEACHER}@example.com`.toLowerCase(),
        role: "NO_ACCESS", schoolId, isActive: true, includeInFeedbackTracker: true },
      { employeeId: LEADER, firstName: "Ss", lastName: "Leader",
        email: `${LEADER}@example.com`.toLowerCase(),
        role: "SCHOOL_LEADER", schoolId, isActive: true, includeInFeedbackTracker: false },
    ]).onConflictDoNothing();

    adminJar  = await loginAs(ADMIN_EID);
    leaderJar = await loginAs(LEADER);
  });

  after(async () => {
    /* Put the windows back so a later test file is not affected. */
    await request("PUT", "/system-settings", { rescoreWindowDays: 14, overdueWindowDays: 14 }, adminJar)
      .catch(() => {});
    await db.delete(observations).where(eq(observations.observedEmployeeId, TEACHER)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
    await db.delete(rubricSets).where(eq(rubricSets.id, rubricSetId)).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — both windows default to 14 days", async () => {
    /* The whole point of the default: deploying this changes nothing until
       somebody moves a control. */
    const res = await request("GET", "/system-settings", undefined, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.rescoreWindowDays, 14);
    assert.equal(res.body.overdueWindowDays, 14);
  });

  test("2 — a new walkthrough uses the configured window", async () => {
    const set = await request("PUT", "/system-settings", { rescoreWindowDays: 21 }, adminJar);
    assert.equal(set.status, 200, JSON.stringify(set.body));

    await walkthroughOn("2026-10-01", adminJar);

    const row = await teacherRow();
    assert.equal(row.needsRescore, true);
    assert.equal(String(row.fromDate), "2026-10-01", "the walkthrough date is recorded");
    assert.equal(daysBetween("2026-10-01", String(row.dueDate)), 21,
      "the deadline should be 21 days out, not the old hardcoded 14");
  });

  test("3 — changing the window recalculates existing entries", async () => {
    const res = await request("PUT", "/system-settings", { rescoreWindowDays: 7 }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.recalculated >= 1, "the queued teacher should have been recalculated");

    const row = await teacherRow();
    assert.equal(daysBetween("2026-10-01", String(row.dueDate)), 7);
  });

  test("4 — recalculation measures from the walkthrough, so it does not compound", async () => {
    /* 21 → 7 → 28 must land 28 days from the observation, not 28 from the
       last deadline. Measuring from a derived date would drift every time. */
    await request("PUT", "/system-settings", { rescoreWindowDays: 28 }, adminJar);
    const row = await teacherRow();
    assert.equal(daysBetween("2026-10-01", String(row.dueDate)), 28);
    assert.equal(String(row.fromDate), "2026-10-01", "the walkthrough date never moves");
  });

  test("5 — the preview reports what a change would do", async () => {
    const res = await request("GET", "/system-settings/preview?rescoreWindowDays=7", undefined, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.rescoreAffected >= 1, "it should count the teacher in the queue");
    assert.equal(typeof res.body.rescoreNewlyOverdue, "number");

    /* The preview must not have changed anything. */
    const row = await teacherRow();
    assert.equal(daysBetween("2026-10-01", String(row.dueDate)), 28,
      "asking what would happen must not make it happen");
  });

  test("6 — only network admins may write; anyone signed in may read", async () => {
    const read = await request("GET", "/system-settings", undefined, leaderJar);
    assert.equal(read.status, 200,
      "a school leader sees the window stated in the Action Center, so must be able to read it");

    const write = await request("PUT", "/system-settings", { rescoreWindowDays: 7 }, leaderJar);
    assert.equal(write.status, 403, JSON.stringify(write.body));

    const preview = await request("GET", "/system-settings/preview?rescoreWindowDays=7", undefined, leaderJar);
    assert.equal(preview.status, 403, "preview is only ever asked on the way to a write");
  });

  test("7 — values outside the offered options are refused", async () => {
    for (const bad of [0, 5, 35, 3.5, -7]) {
      const res = await request("PUT", "/system-settings", { rescoreWindowDays: bad }, adminJar);
      assert.equal(res.status, 400, `rescoreWindowDays=${bad} should be refused`);
    }
    for (const bad of [0, 31, 2.5, -1]) {
      const res = await request("PUT", "/system-settings", { overdueWindowDays: bad }, adminJar);
      assert.equal(res.status, 400, `overdueWindowDays=${bad} should be refused`);
    }
  });

  test("8 — setting a control to what it already says changes nothing", async () => {
    const before = await request("GET", "/system-settings", undefined, adminJar);
    const same = await request("PUT", "/system-settings",
      { rescoreWindowDays: before.body.rescoreWindowDays }, adminJar);
    assert.equal(same.status, 200, JSON.stringify(same.body));
    assert.equal(same.body.recalculated, 0, "no deadline should be rewritten for a non-change");
    assert.equal(same.body.rescoreUpdatedAt, before.body.rescoreUpdatedAt,
      "and nobody's name should be stamped on a decision they did not make");
  });

  test("9 — the two windows are independent", async () => {
    const before = await request("GET", "/system-settings", undefined, adminJar);
    const res = await request("PUT", "/system-settings", { overdueWindowDays: 30 }, adminJar);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.overdueWindowDays, 30);
    assert.equal(res.body.rescoreWindowDays, before.body.rescoreWindowDays,
      "changing one policy must not silently change the other");
    assert.equal(res.body.recalculated, 0, "the overdue window stores nothing per teacher");
  });
});
