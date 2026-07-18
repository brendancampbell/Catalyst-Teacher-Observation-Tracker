/**
 * Integration test: cleanupExpiredQuotaGrants() respects the 7-day grace period.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:quota-grant-cleanup
 *
 * Does NOT require the dev server — talks to the DB directly.
 *
 * Scenarios
 * ---------
 *  1. Row expired 6 days ago  → still within grace period → must NOT be deleted.
 *  2. Row expired 8 days ago  → past grace period          → must be deleted.
 *  3. Running cleanup a second time is idempotent (no crash, count stays at 1).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { aiQuotaGrants, people, schools } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  cleanupExpiredQuotaGrants,
  QUOTA_GRANT_GRACE_INTERVAL,
} from "./lib/quota-grant-cleanup.js";

/* ── Test-fixture IDs ─────────────────────────────────────────────────────── */

const RUN_TAG    = Date.now();
const TESTER_EID = `TST_CLEANUP_${RUN_TAG}`;

let testSchoolId:    number;
let survivorGrantId: number;  /* expires 6 days ago — must survive */
let deletedGrantId:  number;  /* expires 8 days ago — must be deleted */

/* ── Setup ────────────────────────────────────────────────────────────────── */

before(async () => {
  /* Insert a throwaway school (required FK on people) */
  const [school] = await db.insert(schools).values({
    displayName:  `Cleanup Test School ${RUN_TAG}`,
    fullName:     `Cleanup Test School Full ${RUN_TAG}`,
    abbreviation: `CT${String(RUN_TAG).slice(-6)}`,
    region:       "Test",
    gradeSpan:    "K-12",
  }).returning({ id: schools.id });
  testSchoolId = school.id;

  /* Insert a throwaway person (required FK on ai_quota_grants) */
  await db.insert(people).values({
    employeeId: TESTER_EID,
    firstName:  "Cleanup",
    lastName:   `Tester${RUN_TAG}`,
    email:      `cleanup_tester_${RUN_TAG}@test.invalid`,
    role:       "COACH",
    schoolId:   testSchoolId,
    isActive:   true,
  });

  /* Grant A: expired 6 days ago — within the 7-day grace period → must survive */
  const [grantA] = await db.insert(aiQuotaGrants).values({
    employeeId:    TESTER_EID,
    grantType:     "chat",
    extraRequests: 5,
    expiresAt:     new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
  }).returning({ id: aiQuotaGrants.id });
  survivorGrantId = grantA.id;

  /* Grant B: expired 8 days ago — past the 7-day grace period → must be deleted */
  const [grantB] = await db.insert(aiQuotaGrants).values({
    employeeId:    TESTER_EID,
    grantType:     "chat",
    extraRequests: 3,
    expiresAt:     new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
  }).returning({ id: aiQuotaGrants.id });
  deletedGrantId = grantB.id;
});

/* ── Teardown ─────────────────────────────────────────────────────────────── */

after(async () => {
  await db.delete(aiQuotaGrants).where(eq(aiQuotaGrants.employeeId, TESTER_EID));
  await db.delete(people).where(eq(people.employeeId, TESTER_EID));
  await db.delete(schools).where(eq(schools.id, testSchoolId));
  await pool.end();
});

/* ── Tests ────────────────────────────────────────────────────────────────── */

describe("cleanupExpiredQuotaGrants — 7-day grace period", () => {

  test("QUOTA_GRANT_GRACE_INTERVAL is exactly '7 days'", () => {
    assert.equal(
      QUOTA_GRANT_GRACE_INTERVAL,
      "7 days",
      "Grace interval must be '7 days' — changing it silently alters cleanup behaviour",
    );
  });

  test("both fixture rows exist before cleanup runs", async () => {
    const rows = await db
      .select({ id: aiQuotaGrants.id })
      .from(aiQuotaGrants)
      .where(eq(aiQuotaGrants.employeeId, TESTER_EID));

    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes(survivorGrantId), "6-day-old grant must exist before cleanup");
    assert.ok(ids.includes(deletedGrantId),  "8-day-old grant must exist before cleanup");
  });

  test("cleanup deletes the 8-day-old row but keeps the 6-day-old row", async () => {
    await cleanupExpiredQuotaGrants();

    const remaining = await db
      .select({ id: aiQuotaGrants.id })
      .from(aiQuotaGrants)
      .where(eq(aiQuotaGrants.employeeId, TESTER_EID));

    const ids = remaining.map((r) => r.id);

    assert.ok(
      ids.includes(survivorGrantId),
      `6-day-old grant (id=${survivorGrantId}) must NOT be deleted — still within the grace period`,
    );
    assert.ok(
      !ids.includes(deletedGrantId),
      `8-day-old grant (id=${deletedGrantId}) must be deleted — past the 7-day grace period`,
    );
    assert.equal(ids.length, 1, "exactly one grant should remain after cleanup");
  });

  test("running cleanup a second time is idempotent", async () => {
    await assert.doesNotReject(() => cleanupExpiredQuotaGrants());

    const remaining = await db
      .select({ id: aiQuotaGrants.id })
      .from(aiQuotaGrants)
      .where(eq(aiQuotaGrants.employeeId, TESTER_EID));

    const ids = remaining.map((r) => r.id);
    assert.ok(ids.includes(survivorGrantId), "6-day-old grant must still be present after second run");
    assert.equal(ids.length, 1, "still exactly one grant after idempotent second cleanup");
  });
});
