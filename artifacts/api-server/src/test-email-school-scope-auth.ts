/**
 * Regression tests for school-scope auth on POST /api/email/send-observation.
 *
 * Root cause fixed: TEACHER-target observations store schoolId = null on the
 * observation row. The old check compared obs.schoolId === currentUser.schoolId,
 * which was always false (null !== number), so every COACH/SCHOOL_LEADER attempt
 * was rejected with 403. The fix looks up the teacher's schoolId from the people
 * table when obs.observedEmployeeId is set.
 *
 * Scenarios:
 *   1. SCHOOL_LEADER in School A sends email for a teacher in School A → NOT 403
 *      (may be 502 if Resend key absent in test env — that's fine, auth passed)
 *   2. SCHOOL_LEADER in School A attempts to send email for a teacher in School B
 *      → 403
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:email-school-scope-auth
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  observations, observationScores, people, schools, rubricSets,
  rubricCategories, rubricDomains,
} from "@workspace/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function request(
  method: string,
  path: string,
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
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
  assert.ok(setCookie, "dev-login should return Set-Cookie");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

/* ── Test entity IDs ──────────────────────────────────────────────────────── */

const SL_EID        = "TST_EMAIL_SCOPE_SL";       // SCHOOL_LEADER in School A
const TEACHER_A_EID = "TST_EMAIL_SCOPE_TCH_A";    // teacher in School A
const TEACHER_B_EID = "TST_EMAIL_SCOPE_TCH_B";    // teacher in School B

let SCHOOL_A_ID: number;
let SCHOOL_B_ID: number;
let OBS_A_ID: number;   // observation for TEACHER_A (School A)
let OBS_B_ID: number;   // observation for TEACHER_B (School B)
let createdRubricSetId: number;
let createdCategoryId: number;
let createdDomainId: number;
let slJar: Jar;

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

describe("Email send-observation — school-scope authorization", () => {
  before(async () => {
    /* Pick two real schools from the DB */
    const twoSchools = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(2);
    assert.equal(twoSchools.length, 2, "Need at least 2 schools in the DB");
    SCHOOL_A_ID = twoSchools[0]!.id;
    SCHOOL_B_ID = twoSchools[1]!.id;

    /* Minimal TEACHER-target rubric set for observation creation */
    const rsSlug = `tst-email-scope-rs-${Date.now()}`;
    const [rs] = await db
      .insert(rubricSets)
      .values({ slug: rsSlug, name: "Test Email Scope RS", target: "TEACHER", isActive: true })
      .returning({ id: rubricSets.id });
    createdRubricSetId = rs!.id;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: rs!.id, name: "Test Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    createdCategoryId = cat!.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({ categoryId: cat!.id, slug: "tst_email_scope_dom", name: "Test Domain", displayOrder: 1 })
      .returning({ id: rubricDomains.id });
    createdDomainId = dom!.id;

    /* People */
    await db.insert(people).values([
      {
        employeeId:               SL_EID,
        firstName:                "Test",
        lastName:                 "EmailScopeSL",
        email:                    "tst.email.scope.sl@example.com",
        role:                     "SCHOOL_LEADER",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               TEACHER_A_EID,
        firstName:                "Teacher",
        lastName:                 "InSchoolA",
        email:                    "tst.email.scope.tch.a@example.com",
        role:                     "NO_ACCESS",
        schoolId:                 SCHOOL_A_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               TEACHER_B_EID,
        firstName:                "Teacher",
        lastName:                 "InSchoolB",
        email:                    "tst.email.scope.tch.b@example.com",
        role:                     "NO_ACCESS",
        schoolId:                 SCHOOL_B_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
    ]).onConflictDoNothing();

    /* Observations — TEACHER-target means schoolId = null on the row */
    const [obsA] = await db
      .insert(observations)
      .values({
        observedEmployeeId: TEACHER_A_EID,
        schoolId:           null,
        rubricSetId:        createdRubricSetId,
        observerEmployeeId: SL_EID,
        date:               "2025-08-01",
        observer:           "Email Scope SL",
        status:             "published",
        target:             "TEACHER",
      })
      .returning({ id: observations.id });
    OBS_A_ID = obsA!.id;

    const [obsB] = await db
      .insert(observations)
      .values({
        observedEmployeeId: TEACHER_B_EID,
        schoolId:           null,
        rubricSetId:        createdRubricSetId,
        observerEmployeeId: SL_EID,
        date:               "2025-08-02",
        observer:           "Email Scope SL",
        status:             "published",
        target:             "TEACHER",
      })
      .returning({ id: observations.id });
    OBS_B_ID = obsB!.id;

    slJar = await loginAs(SL_EID);
  });

  after(async () => {
    await db.delete(observationScores)
      .where(inArray(observationScores.observationId, [OBS_A_ID, OBS_B_ID])).catch(() => {});
    await db.delete(observations)
      .where(inArray(observations.id, [OBS_A_ID, OBS_B_ID])).catch(() => {});
    await db.delete(rubricDomains)
      .where(eq(rubricDomains.id, createdDomainId)).catch(() => {});
    await db.delete(rubricCategories)
      .where(eq(rubricCategories.id, createdCategoryId)).catch(() => {});
    await db.delete(rubricSets)
      .where(eq(rubricSets.id, createdRubricSetId)).catch(() => {});
    await db.delete(people)
      .where(inArray(people.employeeId, [SL_EID, TEACHER_A_EID, TEACHER_B_EID])).catch(() => {});
  });

  /* 1 ── SCHOOL_LEADER may email a teacher in their own school ─────────────── */

  test("1 — SCHOOL_LEADER in School A can pass auth for a teacher in School A", async () => {
    const res = await request(
      "POST",
      "/email/send-observation",
      {
        observationId: OBS_A_ID,
        intro:         "Great lesson today.",
        subject:       "Observation Feedback",
      },
      slJar,
    );

    assert.notEqual(
      res.status,
      403,
      `Got 403 for own-school teacher — school-scope auth is still broken. Body: ${JSON.stringify(res.body)}`,
    );
    /* Status will be 200 (Resend success) or 502 (Resend unavailable in test env).
       Either is acceptable; the important invariant is that the 403 barrier is gone. */
  });

  /* 2 ── SCHOOL_LEADER cannot email a teacher in a different school ──────────── */

  test("2 — SCHOOL_LEADER in School A is rejected (403) for a teacher in School B", async () => {
    const res = await request(
      "POST",
      "/email/send-observation",
      {
        observationId: OBS_B_ID,
        intro:         "Great lesson today.",
        subject:       "Observation Feedback",
      },
      slJar,
    );

    assert.equal(
      res.status,
      403,
      `Expected 403 for cross-school teacher, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
