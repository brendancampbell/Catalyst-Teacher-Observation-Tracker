/**
 * Regression tests confirming that seeded demo teachers appear in the API endpoints
 * used by the principal dashboard and mobile observation form.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:demo-teachers
 *
 * Requires:
 *   1. The dev server is running (NODE_ENV=development) so /api/auth/dev-login is available.
 *   2. The seed:teachers script has been run at least once so that DEMO-T-001…DEMO-T-026
 *      exist in the database:
 *        pnpm --filter @workspace/api-server run seed:teachers
 *
 * The test is fully idempotent — it only reads data (and does one safe UPDATE to ensure
 * Marcus Wilson's school_id points to RXP_DC so the SCHOOL_LEADER login is meaningful).
 * It never inserts or deletes demo teacher rows.
 *
 * Scenarios:
 *   1. SCHOOL_LEADER for RXP_DC → GET /api/people?includeInFeedbackTracker=true
 *      → all six RXP_DC demo teachers are present
 *   2. SCHOOL_LEADER for RXP_DC → GET /api/people (same endpoint)
 *      → no teachers from any other school are returned (school scope enforced)
 *   3. SCHOOL_LEADER for RXP_DC → GET /api/dashboard?quarter=Q1
 *      → response teachers array contains the specific RXP_DC demo employee IDs
 *   4. NETWORK_ADMIN → GET /api/people?includeInFeedbackTracker=true&schoolId=<RXP_DC_ID>
 *      → returns the same six RXP_DC demo teachers (validates the schoolId query param)
 *   5. NETWORK_ADMIN → GET /api/people?includeInFeedbackTracker=true&schoolId=<RXP_HS_ID>
 *      → does NOT contain any of the RXP_DC demo employee IDs (school isolation)
 *      (RXP_HS has no demo teachers — it is not in the seed:teachers target list)
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const BASE             = `http://localhost:${process.env.PORT ?? 8080}/api`;
const SCHOOL_LEADER_ID = "U13";   /* Marcus Wilson — SCHOOL_LEADER */
const NETWORK_ADMIN_ID = "U10";   /* Brendan Campbell — NETWORK_ADMIN */

/* School abbreviations */
const RXP_DC_ABBR = "RXP_DC";   /* target school — has demo teachers DEMO-T-001…DEMO-T-006 */
const RXP_HS_ABBR = "RXP_HS";   /* isolation school — NOT in seed:teachers target list */

/* The six demo employee IDs that seed:teachers inserts for RXP_DC */
const RXP_DC_DEMO_IDS = [
  "DEMO-T-001", /* Aaliyah Brooks — Math      */
  "DEMO-T-002", /* Brandon Kim    — English   */
  "DEMO-T-003", /* Carmen Diaz    — Science   */
  "DEMO-T-004", /* Derek Stone    — History   */
  "DEMO-T-005", /* Emily Nguyen   — Math      */
  "DEMO-T-006", /* Felix Morales  — English   */
] as const;

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function get(path: string, jar: Jar): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: jar.cookieHeader },
  });
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ employeeId }),
  });
  const setCookie = res.headers.get("set-cookie");
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: status ${res.status}`);
  assert.ok(setCookie, "dev-login should return a Set-Cookie header");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

/* ── Shared state ─────────────────────────────────────────────────────────── */

let slJar:    Jar;   /* SCHOOL_LEADER session (Marcus Wilson, RXP_DC) */
let adminJar: Jar;   /* NETWORK_ADMIN session (Brendan Campbell) */
let rxpDcId:  number;
let rxpHsId:  number;

/* ── Suite ────────────────────────────────────────────────────────────────── */

describe("Demo teacher visibility — /api/people and /api/dashboard", () => {
  before(async () => {
    /* 1. Resolve RXP_DC school id */
    const rxpDcSchool = await db.query.schools.findFirst({
      where: eq(schools.abbreviation, RXP_DC_ABBR),
    });
    assert.ok(
      rxpDcSchool,
      `School "${RXP_DC_ABBR}" not found — ensure the server has started at least once ` +
      "so schools are auto-seeded.",
    );
    rxpDcId = rxpDcSchool.id;

    /* 2. Resolve RXP_HS school id (used for the school-isolation test) */
    const rxpHsSchool = await db.query.schools.findFirst({
      where: eq(schools.abbreviation, RXP_HS_ABBR),
    });
    assert.ok(
      rxpHsSchool,
      `Isolation school "${RXP_HS_ABBR}" not found — ensure the server has been started.`,
    );
    rxpHsId = rxpHsSchool.id;

    /* 3. Verify DEMO-T-001 exists and is linked to RXP_DC (seed:teachers guard) */
    const demoCheck = await db.query.people.findFirst({
      where: eq(people.employeeId, "DEMO-T-001"),
    });
    assert.ok(
      demoCheck,
      "Demo teacher DEMO-T-001 not found. " +
      "Run `pnpm --filter @workspace/api-server run seed:teachers` before this test.",
    );
    assert.equal(
      demoCheck.schoolId,
      rxpDcId,
      `DEMO-T-001 should be linked to school ${rxpDcId} (RXP_DC) ` +
      `but found schoolId=${demoCheck.schoolId}.`,
    );

    /* 4. Idempotently link Marcus Wilson (SCHOOL_LEADER) to RXP_DC */
    await db
      .update(people)
      .set({ schoolId: rxpDcId })
      .where(eq(people.employeeId, SCHOOL_LEADER_ID));

    /* 5. Login both users */
    slJar    = await loginAs(SCHOOL_LEADER_ID);
    adminJar = await loginAs(NETWORK_ADMIN_ID);
  });

  /* ── Test 1: SCHOOL_LEADER /api/people returns all six RXP_DC demo teachers ─ */

  test("1 — SCHOOL_LEADER /api/people returns all six RXP_DC demo teachers", async () => {
    const res = await get("/people?includeInFeedbackTracker=true", slJar);

    assert.equal(
      res.status,
      200,
      `Expected 200 from /api/people, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const body = res.body as Array<{ employeeId: string }>;
    assert.ok(Array.isArray(body), `/api/people should return an array`);

    const returnedIds = new Set(body.map((p) => p.employeeId));
    for (const id of RXP_DC_DEMO_IDS) {
      assert.ok(
        returnedIds.has(id),
        `Expected RXP_DC demo teacher "${id}" in /api/people response but it was missing. ` +
        `Returned IDs: ${JSON.stringify([...returnedIds])}`,
      );
    }
  });

  /* ── Test 2: SCHOOL_LEADER /api/people returns only their school ──────────── */

  test("2 — SCHOOL_LEADER /api/people returns only teachers from their school", async () => {
    const res = await get("/people?includeInFeedbackTracker=true", slJar);

    assert.equal(res.status, 200);
    const body = res.body as Array<{ employeeId: string; schoolId: number | null }>;
    assert.ok(Array.isArray(body));

    const leakingTeacher = body.find((p) => p.schoolId !== null && p.schoolId !== rxpDcId);
    assert.ok(
      !leakingTeacher,
      `Cross-school data leak: SCHOOL_LEADER saw teacher "${leakingTeacher?.employeeId}" ` +
      `from schoolId=${leakingTeacher?.schoolId} (expected only schoolId=${rxpDcId}).`,
    );
  });

  /* ── Test 3: /api/dashboard returns the specific RXP_DC demo teachers ─────── */

  test("3 — SCHOOL_LEADER /api/dashboard returns RXP_DC demo teachers", async () => {
    const res = await get("/dashboard?quarter=Q1", slJar);

    assert.equal(
      res.status,
      200,
      `Expected 200 from /api/dashboard, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const body = res.body as { teachers?: Array<{ employeeId: string }> };
    assert.ok(
      body.teachers !== undefined && Array.isArray(body.teachers),
      `/api/dashboard should have a 'teachers' array. ` +
      `Keys: ${JSON.stringify(Object.keys(body as object))}`,
    );

    const returnedIds = new Set(body.teachers.map((t) => t.employeeId));

    /* At least one specific RXP_DC demo employee ID must be present */
    const found = RXP_DC_DEMO_IDS.filter((id) => returnedIds.has(id));
    assert.ok(
      found.length > 0,
      `No RXP_DC demo teacher found in /api/dashboard response. ` +
      `Expected at least one of: ${JSON.stringify(RXP_DC_DEMO_IDS)}. ` +
      `Returned IDs: ${JSON.stringify([...returnedIds])}`,
    );
  });

  /* ── Test 4: NETWORK_ADMIN with schoolId=RXP_DC returns RXP_DC demo teachers ─ */

  test("4 — NETWORK_ADMIN /api/people?schoolId=<rxpDcId> returns RXP_DC demo teachers", async () => {
    const res = await get(`/people?includeInFeedbackTracker=true&schoolId=${rxpDcId}`, adminJar);

    assert.equal(
      res.status,
      200,
      `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const body = res.body as Array<{ employeeId: string }>;
    assert.ok(Array.isArray(body));

    const returnedIds = new Set(body.map((p) => p.employeeId));
    for (const id of RXP_DC_DEMO_IDS) {
      assert.ok(
        returnedIds.has(id),
        `Expected demo teacher "${id}" when filtering by schoolId=${rxpDcId} but it was absent. ` +
        `Returned IDs: ${JSON.stringify([...returnedIds])}`,
      );
    }
  });

  /* ── Test 5: NETWORK_ADMIN with schoolId=RXP_HS does NOT return RXP_DC demos ─ */

  test(
    "5 — NETWORK_ADMIN /api/people?schoolId=<rxpHsId> does not return RXP_DC demo teachers",
    async () => {
      /* RXP_HS (Roxbury Prep HS) is NOT in the seed:teachers target list, so none of the
         RXP_DC demo employee IDs (DEMO-T-001…DEMO-T-006) should appear. */
      const res = await get(
        `/people?includeInFeedbackTracker=true&schoolId=${rxpHsId}`,
        adminJar,
      );

      assert.equal(
        res.status,
        200,
        `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
      );

      const body = res.body as Array<{ employeeId: string }>;
      assert.ok(Array.isArray(body));

      const returnedIds = new Set(body.map((p) => p.employeeId));
      for (const id of RXP_DC_DEMO_IDS) {
        assert.ok(
          !returnedIds.has(id),
          `School isolation failure: RXP_DC demo teacher "${id}" appeared when filtering ` +
          `by schoolId=${rxpHsId} (${RXP_HS_ABBR}). ` +
          `This indicates the school filter is not working correctly.`,
        );
      }
    },
  );
});

/* Ensure the pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
