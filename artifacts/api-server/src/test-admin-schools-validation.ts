/**
 * Integration tests for region / grade-span validation on the admin-schools endpoints.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/test-admin-schools-validation.ts
 *
 * Requires the dev server to be running (NODE_ENV=development) because it
 * uses the /api/auth/dev-login bypass to establish a session without OAuth.
 *
 * Scenarios:
 *   POST /api/admin/schools — invalid region          → 400, lists valid regions
 *   POST /api/admin/schools — invalid grade span      → 400, lists valid grade spans
 *   POST /api/admin/schools — valid payload           → 201
 *   PATCH /api/admin/schools/:id — invalid region     → 400
 *   PATCH /api/admin/schools/:id — invalid grade span → 400
 *   POST /api/admin/schools/bulk — invalid region row → 200, failed array with message
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { schools, REGIONS, GRADE_SPANS } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;
const NETWORK_ADMIN_ID = "U10"; /* Brendan Campbell — NETWORK_ADMIN */

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

type Jar = { cookieHeader: string };

async function apiPost(path: string, body: unknown, jar?: Jar) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jar?.cookieHeader) headers["Cookie"] = jar.cookieHeader;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let responseBody: unknown;
  try { responseBody = await res.json(); } catch { responseBody = null; }
  return { status: res.status, body: responseBody, setCookie: res.headers.get("set-cookie") ?? undefined };
}

async function apiPatch(path: string, body: unknown, jar: Jar) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Cookie": jar.cookieHeader,
    },
    body: JSON.stringify(body),
  });
  let responseBody: unknown;
  try { responseBody = await res.json(); } catch { responseBody = null; }
  return { status: res.status, body: responseBody };
}

async function apiDelete(path: string, jar: Jar) {
  await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: { "Cookie": jar.cookieHeader },
  });
}

function extractCookie(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await apiPost("/auth/dev-login", { employeeId });
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${JSON.stringify(res.body)}`);
  assert.ok(res.setCookie, "dev-login should return a Set-Cookie header");
  return { cookieHeader: extractCookie(res.setCookie!) };
}

/* ── Test state ──────────────────────────────────────────────────────────── */

const VALID_SCHOOL = {
  displayName:  "Test Admin Validation School",
  fullName:     "Test Admin Validation School Full Name",
  abbreviation: "TST_ADMIN_VAL",
  region:       "Newark",
  gradeSpan:    "ES",
};

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("Admin schools — region & grade-span validation", () => {
  let jar: Jar;
  let createdSchoolId: number | undefined;

  before(async () => {
    jar = await loginAs(NETWORK_ADMIN_ID);
    /* Clean up any leftover test school from a previous run */
    await db.delete(schools).where(eq(schools.abbreviation, VALID_SCHOOL.abbreviation));
  });

  after(async () => {
    if (createdSchoolId !== undefined) {
      await db.delete(schools).where(eq(schools.id, createdSchoolId));
    } else {
      await db.delete(schools).where(eq(schools.abbreviation, VALID_SCHOOL.abbreviation));
    }
  });

  /* ── POST /api/admin/schools ── */

  test("POST with invalid region → 400 and lists valid regions", async () => {
    const res = await apiPost("/admin/schools", {
      ...VALID_SCHOOL,
      region: "INVALID_REGION_XYZ",
    }, jar);

    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { error?: string };
    assert.ok(body.error, "Response should have an error field");
    assert.ok(
      body.error.includes("INVALID_REGION_XYZ"),
      `Error should mention the bad value. Got: "${body.error}"`
    );
    /* Must list at least one valid region in the message */
    const mentionesSomeRegion = (REGIONS as readonly string[])
      .some(r => body.error!.includes(r));
    assert.ok(mentionesSomeRegion, `Error should list valid regions. Got: "${body.error}"`);
  });

  test("POST with invalid grade span → 400 and lists valid spans", async () => {
    const res = await apiPost("/admin/schools", {
      ...VALID_SCHOOL,
      gradeSpan: "BAD_SPAN",
    }, jar);

    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { error?: string };
    assert.ok(body.error, "Response should have an error field");
    assert.ok(
      body.error.includes("BAD_SPAN"),
      `Error should mention the bad value. Got: "${body.error}"`
    );
    const mentionsSomeSpan = (GRADE_SPANS as readonly string[]).some(s => body.error!.includes(s));
    assert.ok(mentionsSomeSpan, `Error should list valid grade spans. Got: "${body.error}"`);
  });

  test("POST with valid payload → 201 and returns school", async () => {
    const res = await apiPost("/admin/schools", VALID_SCHOOL, jar);

    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { id?: number; abbreviation?: string };
    assert.ok(body.id, "Response should include the new school id");
    assert.equal(body.abbreviation, VALID_SCHOOL.abbreviation);
    createdSchoolId = body.id;
  });

  /* ── PATCH /api/admin/schools/:id ── */

  test("PATCH with invalid region → 400", async () => {
    assert.ok(createdSchoolId, "Need a valid school id from previous test");
    const res = await apiPatch(`/admin/schools/${createdSchoolId}`, { region: "BOGUS_REGION" }, jar);

    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { error?: string };
    assert.ok(body.error, "Response should have an error field");
    assert.ok(
      body.error.includes("BOGUS_REGION"),
      `Error should mention the bad value. Got: "${body.error}"`
    );
  });

  test("PATCH with invalid grade span → 400", async () => {
    assert.ok(createdSchoolId, "Need a valid school id from previous test");
    const res = await apiPatch(`/admin/schools/${createdSchoolId}`, { gradeSpan: "BOGUS_SPAN" }, jar);

    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { error?: string };
    assert.ok(body.error, "Response should have an error field");
    assert.ok(
      body.error.includes("BOGUS_SPAN"),
      `Error should mention the bad value. Got: "${body.error}"`
    );
  });

  /* ── POST /api/admin/schools/bulk ── */

  test("POST /bulk with invalid region row → 200 with failed entry containing descriptive message", async () => {
    const res = await apiPost("/admin/schools/bulk", [
      {
        displayName:  "Bulk Validation Test School",
        fullName:     "Bulk Validation Test School Full Name",
        abbreviation: "TST_BULK_VAL",
        region:       "NOT_A_REAL_REGION",
        gradeSpan:    "ES",
      },
    ], jar);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { added: number; updated: number; failed: { row: number; error: string }[] };
    assert.equal(body.added, 0, "No rows should be added");
    assert.equal(body.updated, 0, "No rows should be updated");
    assert.ok(Array.isArray(body.failed), "failed should be an array");
    assert.ok(body.failed.length > 0, "Should have at least one failure");
    const entry = body.failed[0]!;
    assert.ok(
      entry.error.includes("NOT_A_REAL_REGION"),
      `Error should mention the bad value. Got: "${entry.error}"`
    );
    const mentionsValidRegion = (REGIONS as readonly string[])
      .some(r => entry.error.includes(r));
    assert.ok(mentionsValidRegion, `Error should list valid regions. Got: "${entry.error}"`);
  });

  test("POST /bulk with invalid grade span row → 200 with failed entry containing descriptive message", async () => {
    const res = await apiPost("/admin/schools/bulk", [
      {
        displayName:  "Bulk GradeSpan Test School",
        fullName:     "Bulk GradeSpan Test School Full Name",
        abbreviation: "TST_BULK_GS",
        region:       "Newark",
        gradeSpan:    "NOT_A_REAL_SPAN",
      },
    ], jar);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { added: number; updated: number; failed: { row: number; error: string }[] };
    assert.equal(body.added, 0);
    assert.equal(body.updated, 0);
    assert.ok(body.failed.length > 0, "Should have at least one failure");
    const entry = body.failed[0]!;
    assert.ok(
      entry.error.includes("NOT_A_REAL_SPAN"),
      `Error should mention the bad value. Got: "${entry.error}"`
    );
    const mentionsValidSpan = (GRADE_SPANS as readonly string[]).some(s => entry.error.includes(s));
    assert.ok(mentionsValidSpan, `Error should list valid grade spans. Got: "${entry.error}"`);
  });
});

/* Ensure pool closes so the process exits cleanly */
process.on("exit", () => { pool.end().catch(() => {}); });
