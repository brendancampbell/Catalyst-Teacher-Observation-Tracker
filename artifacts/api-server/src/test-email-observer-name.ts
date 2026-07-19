/**
 * Tests for observer name resolution in POST /api/email/send-observation.
 *
 * After the schema hardening migration the `observer` column was dropped from
 * `observations`.  The observer display name is now derived by joining to the
 * `people` table via `observerEmployeeId`.  This suite verifies:
 *
 *   Unit (buildHtmlEmail):
 *   1. Named observer string → name appears verbatim in the rendered HTML
 *   2. Empty observer string  → Observer row renders without crashing
 *
 *   Integration (live DB + buildHtmlEmail pipeline):
 *   3. observerEmployeeId set → DB lookup resolves "Bobby Observer", and that
 *      name appears verbatim in the HTML produced by buildHtmlEmail.
 *
 *   Integration (route via live API — crash-safety checks):
 *   4. Route with observerEmployeeId set → does not return 500
 *      (200 if Resend is live, 502 when Resend unavailable in test env)
 *   5. observerEmployeeId = null → empty-string fallback, not 500
 *   6. Observer person row deleted (FK onDelete: "set null") → observerEmployeeId
 *      is automatically nulled by Postgres; route still succeeds (not 500)
 *
 * Run:
 *   pnpm --filter @workspace/api-server run test:email-observer-name
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  observations,
  observationScores,
  people,
  schools,
  rubricSets,
  rubricCategories,
  rubricDomains,
  schoolYears,
} from "@workspace/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { buildHtmlEmail } from "./routes/email.js";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function apiPost(
  path: string,
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar.cookieHeader) headers["Cookie"] = jar.cookieHeader;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
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
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: status ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "dev-login should return Set-Cookie");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

/* ── Minimal buildHtmlEmail params ───────────────────────────────────────── */

function minimalEmailParams(observer: string) {
  return {
    intro:          "Great lesson.",
    glowsText:      "Strong pacing.",
    growsText:      "More wait time.",
    teacherName:    "Alice Teacher",
    teacherSubject: null,
    teacherGrade:   null,
    date:           "2026-05-01",
    time:           null,
    course:         null,
    observer,
    scoreMap:       {},
    prevScoreMap:   {},
    categories:     [],
    logoUrl:        "https://www.uncommonschools.org/favicon.ico",
  };
}

/* ── Test employee IDs ────────────────────────────────────────────────────── */

const OBSERVER_EID   = "TST_OBS_NAME_COACH";  // coach whose name should appear
const TEACHER_EID    = "TST_OBS_NAME_TCH";    // teacher (email recipient)
const TRANSIENT_EID  = "TST_OBS_NAME_GONE";   // will be deleted mid-test (FK cascade)

let SCHOOL_ID: number;
let OBS_WITH_OBSERVER_ID:  number;   // observerEmployeeId = OBSERVER_EID
let OBS_NULL_OBSERVER_ID:  number;   // observerEmployeeId = null
let OBS_GONE_OBSERVER_ID:  number;   // observerEmployeeId will be nulled by FK cascade
let createdRubricSetId: number;
let createdCategoryId:  number;
let createdDomainId:    number;
let coachJar: Jar;

/* ── Suite ────────────────────────────────────────────────────────────────── */

describe("Email observer name — schema-change regression", () => {

  /* ── Unit tests (no DB or HTTP needed) ───────────────────────────────── */

  test("1 — buildHtmlEmail: named observer appears in the HTML Observer row", () => {
    const html = buildHtmlEmail(minimalEmailParams("Bobby Observer"));
    assert.ok(
      html.includes("Bobby Observer"),
      `Expected observer name "Bobby Observer" in rendered HTML but it was absent.\n` +
      `Observer-section snippet: ${html.slice(html.indexOf("Observer"), html.indexOf("Observer") + 300)}`,
    );
  });

  test("2 — buildHtmlEmail: empty observer string renders without crashing", () => {
    let html = "";
    assert.doesNotThrow(() => { html = buildHtmlEmail(minimalEmailParams("")); });
    assert.ok(
      html.includes("Observer"),
      "Observer label row must still be present even when name is empty",
    );
  });

  /* ── Integration tests (require live API server) ─────────────────────── */

  before(async () => {
    /* Pick a real school */
    const [firstSchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(1);
    assert.ok(firstSchool, "Need at least 1 school in the DB");
    SCHOOL_ID = firstSchool.id;

    /* Active school year */
    const [activeYear] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);
    assert.ok(activeYear, "Need an active school year");

    /* Minimal rubric set */
    const rsSlug = `tst-obs-name-rs-${Date.now()}`;
    const [rs] = await db
      .insert(rubricSets)
      .values({ slug: rsSlug, name: "Test Observer Name RS", target: "TEACHER", isActive: true, schoolYearId: activeYear.id })
      .returning({ id: rubricSets.id });
    createdRubricSetId = rs!.id;

    const [cat] = await db
      .insert(rubricCategories)
      .values({ rubricSetId: createdRubricSetId, name: "Test Cat", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    createdCategoryId = cat!.id;

    const [dom] = await db
      .insert(rubricDomains)
      .values({
        categoryId:   createdCategoryId,
        rubricSetId:  createdRubricSetId,
        schoolYearId: activeYear.id,
        slug:         `tst-obs-name-dom-${Date.now()}`,
        name:         "Test Domain",
        displayOrder: 1,
      })
      .returning({ id: rubricDomains.id });
    createdDomainId = dom!.id;

    /* People */
    await db.insert(people).values([
      {
        employeeId:               OBSERVER_EID,
        firstName:                "Bobby",
        lastName:                 "Observer",
        email:                    "tst.obs.name.coach@example.com",
        role:                     "COACH",
        schoolId:                 SCHOOL_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               TEACHER_EID,
        firstName:                "Trudy",
        lastName:                 "Observed",
        email:                    "tst.obs.name.teacher@example.com",
        role:                     "NO_ACCESS",
        schoolId:                 SCHOOL_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
      {
        employeeId:               TRANSIENT_EID,
        firstName:                "Gone",
        lastName:                 "Person",
        email:                    "tst.obs.name.gone@example.com",
        role:                     "COACH",
        schoolId:                 SCHOOL_ID,
        isActive:                 true,
        includeInFeedbackTracker: false,
      },
    ]).onConflictDoNothing();

    /* Observations */
    const [o1] = await db
      .insert(observations)
      .values({
        schoolYearId:       activeYear.id,
        observedEmployeeId: TEACHER_EID,
        schoolId:           null,
        rubricSetId:        createdRubricSetId,
        observerEmployeeId: OBSERVER_EID,
        date:               "2026-05-01",
        status:             "published",
        target:             "TEACHER",
      })
      .returning({ id: observations.id });
    OBS_WITH_OBSERVER_ID = o1!.id;

    const [o2] = await db
      .insert(observations)
      .values({
        schoolYearId:       activeYear.id,
        observedEmployeeId: TEACHER_EID,
        schoolId:           null,
        rubricSetId:        createdRubricSetId,
        observerEmployeeId: null,
        date:               "2026-05-02",
        status:             "published",
        target:             "TEACHER",
      })
      .returning({ id: observations.id });
    OBS_NULL_OBSERVER_ID = o2!.id;

    const [o3] = await db
      .insert(observations)
      .values({
        schoolYearId:       activeYear.id,
        observedEmployeeId: TEACHER_EID,
        schoolId:           null,
        rubricSetId:        createdRubricSetId,
        observerEmployeeId: TRANSIENT_EID,
        date:               "2026-05-04",
        status:             "published",
        target:             "TEACHER",
      })
      .returning({ id: observations.id });
    OBS_GONE_OBSERVER_ID = o3!.id;

    /* Delete the transient person — Postgres should null observerEmployeeId via
       the onDelete: "set null" FK so that test 5 exercises the cascade path. */
    await db.delete(people).where(eq(people.employeeId, TRANSIENT_EID));

    coachJar = await loginAs(OBSERVER_EID);
  });

  after(async () => {
    const obsIds = [OBS_WITH_OBSERVER_ID, OBS_NULL_OBSERVER_ID, OBS_GONE_OBSERVER_ID].filter(Boolean);
    if (obsIds.length) {
      await db.delete(observationScores).where(inArray(observationScores.observationId, obsIds)).catch(() => {});
      await db.delete(observations).where(inArray(observations.id, obsIds)).catch(() => {});
    }
    if (createdDomainId)    await db.delete(rubricDomains).where(eq(rubricDomains.id, createdDomainId)).catch(() => {});
    if (createdCategoryId)  await db.delete(rubricCategories).where(eq(rubricCategories.id, createdCategoryId)).catch(() => {});
    if (createdRubricSetId) await db.delete(rubricSets).where(eq(rubricSets.id, createdRubricSetId)).catch(() => {});
    await db.delete(people)
      .where(inArray(people.employeeId, [OBSERVER_EID, TEACHER_EID, TRANSIENT_EID]))
      .catch(() => {});
  });

  test("3 — observerEmployeeId → DB lookup resolves full name, name appears in rendered HTML", async () => {
    /* Replicate the exact resolution the route performs:
     *   1. Load the observation
     *   2. findFirst on people where employeeId = obs.observerEmployeeId
     *   3. Join firstName + lastName → pass to buildHtmlEmail
     *   4. Assert the name appears verbatim in the HTML output
     *
     * This tests the full pipeline (DB → name → HTML) without needing Resend. */
    const [obs] = await db
      .select({ observerEmployeeId: observations.observerEmployeeId })
      .from(observations)
      .where(eq(observations.id, OBS_WITH_OBSERVER_ID))
      .limit(1);
    assert.ok(obs, "Observation fixture must exist");
    assert.equal(obs.observerEmployeeId, OBSERVER_EID, "observerEmployeeId should point to OBSERVER_EID fixture");

    /* Same query as the route */
    const observerPerson = obs.observerEmployeeId
      ? await db.query.people.findFirst({ where: eq(people.employeeId, obs.observerEmployeeId) })
      : undefined;
    const observerName = observerPerson
      ? `${observerPerson.firstName} ${observerPerson.lastName}`.trim()
      : "";

    assert.equal(
      observerName,
      "Bobby Observer",
      `DB lookup should resolve to "Bobby Observer" but got "${observerName}"`,
    );

    const html = buildHtmlEmail(minimalEmailParams(observerName));
    assert.ok(
      html.includes("Bobby Observer"),
      `Expected "Bobby Observer" in rendered HTML after DB-resolved name was passed to buildHtmlEmail.\n` +
      `Observer-section snippet: ${html.slice(html.indexOf("Observer"), html.indexOf("Observer") + 300)}`,
    );
  });

  test("4 — route with observerEmployeeId set → does not return 500", async () => {
    /* Route-level crash-safety check: Resend may be unavailable (→ 502) but
       the observer DB lookup must not crash the handler (→ 500). */
    const res = await apiPost(
      "/email/send-observation",
      { observationId: OBS_WITH_OBSERVER_ID, intro: "Great.", subject: "Feedback" },
      coachJar,
    );
    assert.notEqual(
      res.status,
      500,
      `Route returned 500 with observerEmployeeId set — DB lookup for observer name likely threw.\n` +
      `Body: ${JSON.stringify(res.body)}`,
    );
    assert.notEqual(
      res.status,
      403,
      `Unexpected 403 for COACH on own-school observation. Body: ${JSON.stringify(res.body)}`,
    );
  });

  test("5 — observerEmployeeId = null → empty-string fallback: route does not return 500", async () => {
    const res = await apiPost(
      "/email/send-observation",
      { observationId: OBS_NULL_OBSERVER_ID, intro: "Great.", subject: "Feedback" },
      coachJar,
    );
    assert.notEqual(
      res.status,
      500,
      `Route returned 500 with observerEmployeeId = null — "?? \\"\\""" fallback may have crashed.\n` +
      `Body: ${JSON.stringify(res.body)}`,
    );
  });

  test("6 — observer person deleted (FK → null) → route does not return 500", async () => {
    /* Confirm the FK cascade actually nulled the field */
    const [row] = await db
      .select({ observerEmployeeId: observations.observerEmployeeId })
      .from(observations)
      .where(eq(observations.id, OBS_GONE_OBSERVER_ID))
      .limit(1);
    assert.equal(
      row?.observerEmployeeId,
      null,
      "Expected observerEmployeeId to be null after the referenced person was deleted (onDelete: set null)",
    );

    const res = await apiPost(
      "/email/send-observation",
      { observationId: OBS_GONE_OBSERVER_ID, intro: "Great.", subject: "Feedback" },
      coachJar,
    );
    assert.notEqual(
      res.status,
      500,
      `Route returned 500 after FK-cascade null — fallback to "" may have thrown.\n` +
      `Body: ${JSON.stringify(res.body)}`,
    );
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
