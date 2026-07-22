/**
 * Integration test: slug rename in PATCH /api/rubric/sets/:slug cascades
 * to chat_messages.rubric_set_slug.
 *
 * Scenarios:
 *   1. Renaming a slug with 0 observations → 200, chat_messages updated
 *   2. Messages referencing a DIFFERENT slug → untouched
 *   3. Renaming is blocked when observations exist → 409, chat_messages unchanged
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:rubric-set-slug-chat-cascade
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import {
  people,
  schools,
  schoolYears,
  rubricSets,
  observations,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;
const ts   = Date.now() + Math.floor(Math.random() * 1_000_000);

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "dev-login should return a Set-Cookie header");
  return { cookieHeader: setCookie!.split(";")[0] ?? "" };
}

async function apiPatch(
  path: string,
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: jar.cookieHeader,
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: parsed };
}

/* ── DB helpers ───────────────────────────────────────────────────────────── */

async function seedChatMessage(sessionId: number, rubricSetSlug: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO chat_messages (session_id, role, content, rubric_set_slug)
     VALUES ($1, 'user', 'test message', $2)
     RETURNING id`,
    [sessionId, rubricSetSlug],
  );
  return rows[0]!.id;
}

async function getChatSlug(messageId: number): Promise<string | null> {
  const { rows } = await pool.query<{ rubric_set_slug: string | null }>(
    `SELECT rubric_set_slug FROM chat_messages WHERE id = $1`,
    [messageId],
  );
  return rows[0]?.rubric_set_slug ?? null;
}

/* ── Test state ───────────────────────────────────────────────────────────── */

let SCHOOL_YEAR_ID = 1;
let adminEmployeeId: string | null = null;
let jar: Jar;

let renameSetId:   number | null = null;
let guardedSetId:  number | null = null;
let chatSessionId: number | null = null;
let createdObsIds: number[]      = [];
let createdMsgIds: number[]      = [];

async function cleanup() {
  if (createdObsIds.length > 0) {
    await db.delete(observations).where(inArray(observations.id, createdObsIds));
    createdObsIds = [];
  }
  if (createdMsgIds.length > 0) {
    await pool.query(`DELETE FROM chat_messages WHERE id = ANY($1::int[])`, [createdMsgIds]);
    createdMsgIds = [];
  }
  if (chatSessionId !== null) {
    await pool.query(`DELETE FROM chat_sessions WHERE id = $1`, [chatSessionId]);
    chatSessionId = null;
  }
  const setIds = [renameSetId, guardedSetId].filter((id): id is number => id !== null);
  if (setIds.length > 0) {
    await db.delete(rubricSets).where(inArray(rubricSets.id, setIds));
    renameSetId  = null;
    guardedSetId = null;
  }
  if (adminEmployeeId) {
    await db.delete(people).where(eq(people.employeeId, adminEmployeeId));
    adminEmployeeId = null;
  }
}

/* ── Suite ────────────────────────────────────────────────────────────────── */

describe("PATCH /api/rubric/sets/:slug — slug rename cascades to chat_messages", () => {
  const oldSlug     = `rsscc-rename-${ts}`.toUpperCase();
  const newSlug     = `rsscc-renamed-${ts}`.toUpperCase();
  const otherSlug   = `rsscc-other-${ts}`.toUpperCase();
  const guardedSlug = `rsscc-guarded-${ts}`.toUpperCase();

  before(async () => {
    /* Resolve active school year */
    const [activeYear] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);
    assert.ok(activeYear, "An active school year must exist");
    SCHOOL_YEAR_ID = activeYear.id;

    /* Home Office school for admin */
    const [hoSchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, true))
      .limit(1);
    assert.ok(hoSchool, "Home Office school must exist");

    /* Any school + teacher for observation */
    const [anySchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .limit(1);
    assert.ok(anySchool, "At least one school must exist");

    const [teacher] = await db
      .select({ employeeId: people.employeeId })
      .from(people)
      .where(eq(people.role, "COACH"))
      .limit(1);
    assert.ok(teacher, "At least one COACH must exist in seed data");

    /* Network admin */
    adminEmployeeId = `RSSCC${ts}`;
    await db.insert(people).values({
      employeeId:               adminEmployeeId,
      firstName:                "Test",
      lastName:                 `RSSCC${ts}`,
      email:                    `test.rsscc.${ts}@example.com`,
      role:                     "NETWORK_ADMIN",
      schoolId:                 hoSchool.id,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    jar = await loginAs(adminEmployeeId);

    /* Two rubric sets: one for rename test, one guarded by an observation */
    const sets = await db.insert(rubricSets).values([
      { name: `RSSCC Rename ${ts}`,   slug: oldSlug,     displayOrder: 9991, schoolYearId: SCHOOL_YEAR_ID, target: "TEACHER" },
      { name: `RSSCC Guarded ${ts}`,  slug: guardedSlug, displayOrder: 9992, schoolYearId: SCHOOL_YEAR_ID, target: "TEACHER" },
    ]).returning({ id: rubricSets.id });
    renameSetId  = sets[0]!.id;
    guardedSetId = sets[1]!.id;

    /* Observation referencing the guarded set (blocks rename) */
    const [obs] = await db.insert(observations).values({
      observedEmployeeId: teacher.employeeId,
      observerEmployeeId: adminEmployeeId,
      schoolId:           anySchool.id,
      schoolYearId:       SCHOOL_YEAR_ID,
      rubricSetId:        guardedSetId,
      date:               "2025-01-15",
      status:             "published",
    }).returning({ id: observations.id });
    createdObsIds = [obs!.id];

    /* Chat session owned by the admin */
    const { rows: sessionRows } = await pool.query<{ id: number }>(
      `INSERT INTO chat_sessions (employee_id) VALUES ($1) RETURNING id`,
      [adminEmployeeId],
    );
    chatSessionId = sessionRows[0]!.id;

    /* Seed chat messages: two for oldSlug, one for otherSlug, one for guardedSlug */
    const m1 = await seedChatMessage(chatSessionId, oldSlug);
    const m2 = await seedChatMessage(chatSessionId, oldSlug);
    const m3 = await seedChatMessage(chatSessionId, otherSlug);
    const m4 = await seedChatMessage(chatSessionId, guardedSlug);
    createdMsgIds = [m1, m2, m3, m4];
  });

  after(cleanup);

  /* ── Test 1: slug rename → 200 + cascade ─────────────────────────────────── */

  test("1 — renaming slug returns 200 and cascades update to chat_messages", async () => {
    const { status, body } = await apiPatch(`/rubric/sets/${oldSlug}`, { slug: newSlug }, jar);
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    const b = body as { slug?: string };
    assert.equal(b.slug, newSlug, "Response should return the new slug");

    /* Both messages that had oldSlug should now have newSlug */
    const [m1Slug, m2Slug] = await Promise.all([
      getChatSlug(createdMsgIds[0]!),
      getChatSlug(createdMsgIds[1]!),
    ]);
    assert.equal(m1Slug, newSlug, `message 1 slug should be updated to ${newSlug}`);
    assert.equal(m2Slug, newSlug, `message 2 slug should be updated to ${newSlug}`);
  });

  /* ── Test 2: unrelated slug → untouched ──────────────────────────────────── */

  test("2 — chat_messages referencing a different slug are not affected", async () => {
    const m3Slug = await getChatSlug(createdMsgIds[2]!);
    assert.equal(m3Slug, otherSlug, "Message with a different slug must remain unchanged");
  });

  /* ── Test 3: slug rename blocked by observations → chat_messages unchanged ─ */

  test("3 — rename blocked by observations (409) leaves chat_messages unchanged", async () => {
    const { status, body } = await apiPatch(
      `/rubric/sets/${guardedSlug}`,
      { slug: `${guardedSlug}-NEW` },
      jar,
    );
    assert.equal(status, 409, `Expected 409, got ${status}: ${JSON.stringify(body)}`);

    const m4Slug = await getChatSlug(createdMsgIds[3]!);
    assert.equal(m4Slug, guardedSlug, "Blocked rename must leave chat_messages unchanged");
  });
});
