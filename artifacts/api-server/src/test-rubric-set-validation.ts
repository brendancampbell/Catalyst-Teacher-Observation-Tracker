/**
 * Integration tests — Zod validation on rubric-set mutation endpoints.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:rubric-set-validation
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * Scenarios:
 *
 * POST /sets
 *   1.  Invalid slug (lowercase letters) → 400
 *   2.  Empty slug → 400
 *   3.  Missing name → 400
 *   4.  Non-string name (number) → 400
 *   5.  Valid payload → 201
 *
 * PATCH /sets/:slug
 *   6.  String displayOrder (unknown field is fine; but invalid enum target) → 400
 *   7.  String passed as isArchived (boolean expected) → 400
 *   8.  Empty body → 400 "Nothing to update"
 *   9.  Valid name-only update → 200
 *  10.  Invalid slug in body → 400
 *
 * POST /:setSlug/categories
 *  11.  Missing name → 400
 *  12.  Non-integer displayOrder → 400
 *  13.  Valid payload → 201
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, rubricSets, rubricCategories, schoolYears } from "@workspace/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── Test entity IDs ──────────────────────────────────────────────────────── */

const ADMIN_EID = "TST_RUBSET_VAL_ADMIN";
const ALL_EIDS  = [ADMIN_EID];

let RUBRIC_ID:     number;
let RUBRIC_SLUG:   string;

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
  return { cookieHeader: setCookie!.split(";")[0]! };
}

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

describe("Rubric-set mutation validation (POST /sets, PATCH /sets/:slug, POST /:setSlug/categories)", () => {
  before(async () => {
    await db.insert(people).values({
      employeeId:               ADMIN_EID,
      firstName:                "Test",
      lastName:                 "RubSetValAdmin",
      email:                    "tst.rubset.val.admin@example.com",
      role:                     "NETWORK_ADMIN",
      schoolId:                 null,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

    const [activeYear] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);
    assert.ok(activeYear, "Need an active school year in DB");

    /* A rubric set created directly in the DB so PATCH and category-create tests
       don't depend on the POST /sets endpoint working first. */
    RUBRIC_SLUG = "TST-RUBSET-VAL";
    const [rubric] = await db.insert(rubricSets).values({
      slug:         RUBRIC_SLUG,
      name:         "Test RubSet Validation",
      schoolYearId: activeYear.id,
      isActive:     false,
      isArchived:   false,
      displayOrder: 9997,
    }).onConflictDoNothing().returning();
    assert.ok(rubric, "Rubric set fixture must be inserted");
    RUBRIC_ID = rubric.id;
  });

  after(async () => {
    await db.delete(rubricSets).where(eq(rubricSets.id, RUBRIC_ID)).catch(() => {});
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
  });

  /* ── POST /sets ──────────────────────────────────────────────────────────── */

  test("1 — POST /sets with lowercase slug → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", "/rubric/sets", {
      slug: "lowercase-slug",
      name: "Test Set",
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for lowercase slug, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { error?: string };
    assert.ok(body.error, `Expected error message, got: ${JSON.stringify(body)}`);
  });

  test("2 — POST /sets with empty slug → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", "/rubric/sets", {
      slug: "",
      name: "Test Set",
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for empty slug, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("3 — POST /sets with missing name → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", "/rubric/sets", {
      slug: "VALID-SLUG",
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for missing name, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("4 — POST /sets with non-string name (number) → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", "/rubric/sets", {
      slug: "VALID-SLUG",
      name: 42,
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for numeric name, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("5 — POST /sets with valid payload → 201", async () => {
    const jar = await loginAs(ADMIN_EID);
    const slug = "TST-RUBSET-CREATE-OK";
    let createdId: number | undefined;
    try {
      const res = await request("POST", "/rubric/sets", {
        slug,
        name: "Valid RubSet Create",
      }, jar);
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      const body = res.body as { id?: number; slug?: string; name?: string };
      assert.equal(body.slug, slug);
      assert.equal(body.name, "Valid RubSet Create");
      createdId = body.id;
    } finally {
      if (createdId != null) {
        await db.delete(rubricSets).where(eq(rubricSets.id, createdId)).catch(() => {});
      }
    }
  });

  /* ── PATCH /sets/:slug ───────────────────────────────────────────────────── */

  test("6 — PATCH /sets/:slug with invalid enum value for target → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PATCH", `/rubric/sets/${RUBRIC_SLUG}`, {
      target: "INVALID_TARGET",
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for invalid target enum, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("7 — PATCH /sets/:slug with string isArchived → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PATCH", `/rubric/sets/${RUBRIC_SLUG}`, {
      isArchived: "yes",
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for string isArchived, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("8 — PATCH /sets/:slug with empty body → 400 'Nothing to update'", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PATCH", `/rubric/sets/${RUBRIC_SLUG}`, {}, jar);
    assert.equal(res.status, 400, `Expected 400 for empty body, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(
      JSON.stringify(res.body).toLowerCase().includes("nothing"),
      `Expected 'Nothing to update' message, got: ${JSON.stringify(res.body)}`,
    );
  });

  test("9 — PATCH /sets/:slug with valid name-only update → 200", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PATCH", `/rubric/sets/${RUBRIC_SLUG}`, {
      name: "Updated RubSet Name",
    }, jar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { name?: string };
    assert.equal(body.name, "Updated RubSet Name");
  });

  test("10 — PATCH /sets/:slug with invalid slug in body → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PATCH", `/rubric/sets/${RUBRIC_SLUG}`, {
      slug: "bad slug with spaces!",
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for invalid slug in body, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* ── POST /:setSlug/categories ───────────────────────────────────────────── */

  test("6b — PATCH /sets/:slug with string displayOrder (unknown field) → 400 'Nothing to update'", async () => {
    const jar = await loginAs(ADMIN_EID);
    /* displayOrder is not in patchRubricSetSchema — Zod strips it, leaving an
       empty update object → "Nothing to update" (still 400). */
    const res = await request("PATCH", `/rubric/sets/${RUBRIC_SLUG}`, {
      displayOrder: "1",
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for string displayOrder, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  /* ── POST /:setSlug/categories ───────────────────────────────────────────── */

  test("11a — POST /:setSlug/categories with missing name → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", `/rubric/${RUBRIC_SLUG}/categories`, {
      displayOrder: 1,
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for missing name, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("11b — POST /:setSlug/categories with empty name → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", `/rubric/${RUBRIC_SLUG}/categories`, {
      name: "",
      displayOrder: 0,
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for empty name, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("12 — POST /:setSlug/categories with non-integer displayOrder → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", `/rubric/${RUBRIC_SLUG}/categories`, {
      name: "Cat Name",
      displayOrder: "first",
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for string displayOrder, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("13 — POST /:setSlug/categories with valid payload → 201", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", `/rubric/${RUBRIC_SLUG}/categories`, {
      name: "Valid Category",
      displayOrder: 0,
    }, jar);
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { id?: number; name?: string };
    assert.equal(body.name, "Valid Category");
    if (body.id != null) {
      await db.delete(rubricCategories).where(eq(rubricCategories.id, body.id)).catch(() => {});
    }
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
