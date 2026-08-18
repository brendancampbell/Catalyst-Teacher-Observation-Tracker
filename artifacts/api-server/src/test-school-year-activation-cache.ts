/**
 * Integration test — activating a school year immediately clears
 * dashboardCache, districtCache, and networkAvgsCache so no stale
 * analytics data is served after the year switch.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:school-year-activation-cache
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * Scenarios:
 *   1. Prime dashboardCache: second identical request is X-Cache: HIT
 *   2. Prime districtCache: second identical request is X-Cache: HIT
 *   3. Prime networkAvgsCache: second identical request is X-Cache: HIT
 *   4. Activate a different school year
 *   5. /dashboard request is NOT X-Cache: HIT (cache was cleared)
 *   6. /district/summary request is NOT X-Cache: HIT (cache was cleared)
 *   7. /action-center/network-averages request is NOT X-Cache: HIT (cache was cleared)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, rubricSets, schoolYears, schools, assignments } from "@workspace/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const ADM_EID = "TST_SY_CACHE_ADM";

type Jar = { cookieHeader: string };

async function request(
  method: string,
  path: string,
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown; xCache: string | null }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar.cookieHeader) headers["Cookie"] = jar.cookieHeader;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let responseBody: unknown;
  try { responseBody = await res.json(); } catch { responseBody = null; }
  return { status: res.status, body: responseBody, xCache: res.headers.get("X-Cache") };
}

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  const setCookie = res.headers.get("set-cookie");
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: status ${res.status}`);
  assert.ok(setCookie, "dev-login should return Set-Cookie");
  return { cookieHeader: setCookie!.split(";")[0]! };
}

let jar: Jar;
let originalActiveYearId: number;
let alternateYearId: number;
let rubricSetSlug: string;

/* Rows this test creates purely to satisfy the activation gate */
const seededAssignmentIds: number[] = [];
let seededRubricSetId: number | null = null;
let createdYear = false;

describe("School-year activation clears dashboard / district / network-avgs caches", () => {
  before(async () => {
    /* Find the Home Office school (NETWORK_ADMIN must be assigned there) */
    const [hoSchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, true))
      .limit(1);
    assert.ok(hoSchool, "Need a Home Office school in the DB");

    /* Find the currently active school year */
    const [activeYear] = await db
      .select()
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);
    assert.ok(activeYear, "Need an active school year in the DB");
    originalActiveYearId = activeYear.id;

    /* ── Switch to a year this test OWNS, never a real one ───────────────
       This used to grab whichever other year had the lowest id. That is a
       real year with real data in it — and activating away from it runs the
       departure pass with THAT year as outgoing, deactivating anyone who
       exists in it but not in the active year. On this database that was a
       partially-staged 2026-2027, and the round trip deactivated a live
       seeded SCHOOL_LEADER. A test must not be able to do that. */
    const [scratch] = await db.insert(schoolYears).values({
      name:         `TST SY Cache ${Date.now()}`,
      status:       "inactive",
      displayOrder: 9998,
    }).returning({ id: schoolYears.id });
    alternateYearId = scratch!.id;
    createdYear = true;

    /* Find a rubric set slug that belongs to the active year */
    const [rubricSet] = await db
      .select({ slug: rubricSets.slug })
      .from(rubricSets)
      .where(eq(rubricSets.schoolYearId, originalActiveYearId))
      .orderBy(asc(rubricSets.id))
      .limit(1);
    assert.ok(rubricSet, "Need at least one rubric set in the active school year");
    rubricSetSlug = rubricSet.slug;

    /* Seed NETWORK_ADMIN user */
    await db.insert(people).values({
      employeeId:               ADM_EID,
      firstName:                "Test",
      lastName:                 "SYCacheAdm",
      email:                    "tst.sy.cache.adm@example.com",
      role:                     "NETWORK_ADMIN",
      schoolId:                 hoSchool.id,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

    /* ── Satisfy the activation gate ──────────────────────────────────────
       Activation now refuses a year that has no roster, no active rubric
       set, or no assignment for the admin performing the flip.

       Mirror the active year's roster into the alternate year so the flip
       is a no-op for people: everybody present in the outgoing year is also
       present in the incoming one, so nothing is treated as a departure.
       This test is about cache invalidation — rollover side-effects are
       covered by test-school-year-rollover.ts.                           */
    const copied = await pool.query<{ id: number }>(
      `INSERT INTO assignments (user_id, role, school_id, school_year_id, start_date, end_date)
       SELECT user_id, role, school_id, $1, start_date, NULL
         FROM assignments
        WHERE school_year_id = $2 AND end_date IS NULL
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [alternateYearId, originalActiveYearId],
    );
    seededAssignmentIds.push(...copied.rows.map((r) => r.id));

    /* The admin needs an open assignment in BOTH years — the gate is checked
       on the way out as well as the way in, so without one in the original
       year the after() hook could not restore it. */
    for (const yearId of [originalActiveYearId, alternateYearId]) {
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO assignments (user_id, role, school_id, school_year_id, start_date, end_date)
         VALUES ($1, 'NETWORK_ADMIN', $2, $3, CURRENT_DATE, NULL)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [ADM_EID, hoSchool.id, yearId],
      );
      seededAssignmentIds.push(...inserted.rows.map((r) => r.id));
    }

    const [createdRubric] = await db.insert(rubricSets).values({
      slug:         `tst-sy-cache-${Date.now()}`,
      name:         "Test SY Cache Rubric",
      schoolYearId: alternateYearId,
      isActive:     true,
      isArchived:   false,
      target:       "TEACHER",
    }).returning({ id: rubricSets.id });
    seededRubricSetId = createdRubric!.id;

    jar = await loginAs(ADM_EID);
  });

  after(async () => {
    /* Always restore the original active year so the environment is clean */
    await fetch(`${BASE}/admin/school-years/${originalActiveYearId}/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": jar?.cookieHeader ?? "",
      },
      body: JSON.stringify({}),
    }).catch(() => {});

    /* Order matters: the year is restored above while the admin still has an
       assignment in it, then the scaffolding comes down. */
    if (seededAssignmentIds.length > 0) {
      await db.delete(assignments).where(inArray(assignments.id, seededAssignmentIds)).catch(() => {});
    }
    if (seededRubricSetId !== null) {
      await db.delete(rubricSets).where(eq(rubricSets.id, seededRubricSetId)).catch(() => {});
    }
    await db.delete(assignments).where(eq(assignments.userId, ADM_EID)).catch(() => {});
    await db.delete(people).where(eq(people.employeeId, ADM_EID)).catch(() => {});
    if (createdYear) {
      await db.delete(assignments).where(eq(assignments.schoolYearId, alternateYearId)).catch(() => {});
      await db.delete(rubricSets).where(eq(rubricSets.schoolYearId, alternateYearId)).catch(() => {});
      await db.delete(schoolYears).where(eq(schoolYears.id, alternateYearId)).catch(() => {});
    }
  });

  /* ── Prime caches ─────────────────────────────────────────────────────── */

  test("1 — dashboard cache: first request is MISS, second is HIT", async () => {
    const r1 = await request("GET", `/dashboard?rubricSet=${rubricSetSlug}`, undefined, jar);
    assert.equal(r1.status, 200,
      `First dashboard request should be 200 (rubric set ${rubricSetSlug} must exist in active year): got ${r1.status}`);
    assert.equal(r1.xCache, "MISS",
      `First dashboard request should be X-Cache: MISS, got ${r1.xCache}`);

    const r2 = await request("GET", `/dashboard?rubricSet=${rubricSetSlug}`, undefined, jar);
    assert.equal(r2.status, 200, `Second dashboard request should be 200`);
    assert.equal(r2.xCache, "HIT",
      `Second dashboard request must be X-Cache: HIT (cache was primed), got ${r2.xCache}`);
  });

  test("2 — district cache: first request is MISS, second is HIT", async () => {
    const r1 = await request("GET", `/district/summary?rubricSet=${rubricSetSlug}`, undefined, jar);
    assert.equal(r1.status, 200,
      `First district request should be 200: got ${r1.status}`);
    assert.equal(r1.xCache, "MISS",
      `First district request should be X-Cache: MISS, got ${r1.xCache}`);

    const r2 = await request("GET", `/district/summary?rubricSet=${rubricSetSlug}`, undefined, jar);
    assert.equal(r2.status, 200, `Second district request should be 200`);
    assert.equal(r2.xCache, "HIT",
      `Second district request must be X-Cache: HIT, got ${r2.xCache}`);
  });

  test("3 — network-avgs cache: first request is MISS, second is HIT", async () => {
    const r1 = await request("GET", `/action-center/network-averages?rubricSet=${rubricSetSlug}`, undefined, jar);
    assert.equal(r1.status, 200,
      `First network-avgs request should be 200: got ${r1.status}`);
    assert.equal(r1.xCache, "MISS",
      `First network-avgs request should be X-Cache: MISS, got ${r1.xCache}`);

    const r2 = await request("GET", `/action-center/network-averages?rubricSet=${rubricSetSlug}`, undefined, jar);
    assert.equal(r2.status, 200, `Second network-avgs request should be 200`);
    assert.equal(r2.xCache, "HIT",
      `Second network-avgs request must be X-Cache: HIT, got ${r2.xCache}`);
  });

  /* ── Activate alternate year ──────────────────────────────────────────── */

  test("4 — activating the alternate school year returns 200", async () => {
    const r = await request("POST", `/admin/school-years/${alternateYearId}/activate`, {}, jar);
    assert.equal(r.status, 200,
      `School year activation must succeed (200), got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  /* ── Caches must be cleared ───────────────────────────────────────────── */

  test("5 — dashboard cache cleared: response after activation is NOT X-Cache: HIT", async () => {
    const r = await request("GET", `/dashboard?rubricSet=${rubricSetSlug}`, undefined, jar);
    assert.notEqual(r.xCache, "HIT",
      `After year activation, /dashboard must not serve stale cached data — got X-Cache: ${r.xCache} (status ${r.status})`);
  });

  test("6 — district cache cleared: response after activation is NOT X-Cache: HIT", async () => {
    const r = await request("GET", `/district/summary?rubricSet=${rubricSetSlug}`, undefined, jar);
    assert.notEqual(r.xCache, "HIT",
      `After year activation, /district/summary must not serve stale cached data — got X-Cache: ${r.xCache} (status ${r.status})`);
  });

  test("7 — network-avgs cache cleared: response after activation is NOT X-Cache: HIT", async () => {
    const r = await request("GET", `/action-center/network-averages?rubricSet=${rubricSetSlug}`, undefined, jar);
    assert.notEqual(r.xCache, "HIT",
      `After year activation, /action-center/network-averages must not serve stale cached data — got X-Cache: ${r.xCache} (status ${r.status})`);
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
