/**
 * Integration tests: Zod input guards on the three rubric reorder endpoints
 *
 *   PUT /api/rubric/sets/reorder
 *   PUT /api/rubric/categories/reorder
 *   PUT /api/rubric/domains/reorder
 *
 * Each endpoint validates that every item in the array has an integer
 * displayOrder (no floats, no strings) and a required key (slug for sets,
 * numeric id for categories/domains). This test confirms the guard returns 400
 * with a meaningful error message for each class of bad payload so that a
 * future refactor cannot silently remove the validation.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:rubric-reorder-validation
 *
 * Requires the dev server to be running (NODE_ENV=development).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

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

async function apiPut(
  path: string,
  body: unknown,
  jar: Jar,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
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

/* ── Suite ────────────────────────────────────────────────────────────────── */

const ts = Date.now() + Math.floor(Math.random() * 1_000_000);
let adminEmployeeId: string | null = null;

describe("Rubric reorder endpoints — Zod validation guard", () => {
  let jar: Jar;

  before(async () => {
    const [hoSchool] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.isHomeOffice, true))
      .limit(1);
    assert.ok(hoSchool, "Home Office school must exist");

    adminEmployeeId = `TRRV${ts}`;
    await db.insert(people).values({
      employeeId:               adminEmployeeId,
      firstName:                "Test",
      lastName:                 `RRV${ts}`,
      email:                    `test.rrv.${ts}@example.com`,
      role:                     "NETWORK_ADMIN",
      schoolId:                 hoSchool.id,
      includeInFeedbackTracker: false,
      isActive:                 true,
    });
    jar = await loginAs(adminEmployeeId);
  });

  /* Clean up the throwaway admin regardless of test outcomes */
  after(async () => {
    if (adminEmployeeId) {
      await db.delete(people).where(eq(people.employeeId, adminEmployeeId));
      adminEmployeeId = null;
    }
  });

  /* ── PUT /api/rubric/sets/reorder ──────────────────────────────────── */

  test("sets/reorder — float displayOrder → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/sets/reorder",
      [{ slug: "some-set", displayOrder: 1.5 }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
    const b = body as { error?: string };
    assert.ok(
      b.error?.toLowerCase().includes("integer"),
      `error should mention "integer", got: ${b.error}`,
    );
  });

  test("sets/reorder — string displayOrder → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/sets/reorder",
      [{ slug: "some-set", displayOrder: "first" }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
  });

  test("sets/reorder — missing slug → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/sets/reorder",
      [{ displayOrder: 1 }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
  });

  test("sets/reorder — empty slug → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/sets/reorder",
      [{ slug: "", displayOrder: 1 }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
    const b = body as { error?: string };
    assert.ok(
      b.error?.toLowerCase().includes("slug"),
      `error should mention "slug", got: ${b.error}`,
    );
  });

  /* ── PUT /api/rubric/categories/reorder ────────────────────────────── */

  test("categories/reorder — float displayOrder → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/categories/reorder",
      [{ id: 1, displayOrder: 0.5 }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
    const b = body as { error?: string };
    assert.ok(
      b.error?.toLowerCase().includes("integer"),
      `error should mention "integer", got: ${b.error}`,
    );
  });

  test("categories/reorder — string displayOrder → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/categories/reorder",
      [{ id: 1, displayOrder: "second" }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
  });

  test("categories/reorder — missing id → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/categories/reorder",
      [{ displayOrder: 1 }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
  });

  test("categories/reorder — string id → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/categories/reorder",
      [{ id: "abc", displayOrder: 1 }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
  });

  /* ── PUT /api/rubric/domains/reorder ───────────────────────────────── */

  test("domains/reorder — float displayOrder → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/domains/reorder",
      [{ id: 1, displayOrder: 2.7 }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
    const b = body as { error?: string };
    assert.ok(
      b.error?.toLowerCase().includes("integer"),
      `error should mention "integer", got: ${b.error}`,
    );
  });

  test("domains/reorder — string displayOrder → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/domains/reorder",
      [{ id: 1, displayOrder: "third" }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
  });

  test("domains/reorder — missing id → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/domains/reorder",
      [{ displayOrder: 1 }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
  });

  test("domains/reorder — string id → 400", async () => {
    const { status, body } = await apiPut(
      "/rubric/domains/reorder",
      [{ id: "xyz", displayOrder: 1 }],
      jar,
    );
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
  });
});
