/**
 * Integration tests — Zod validation on rubric category/domain mutation endpoints
 * and the slug-rename guard on PUT /domains/:id.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:rubric-category-domain-validation
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * Scenarios:
 *
 * POST /categories/:id/domains
 *   1.  Missing name → 400
 *   2.  Missing slug → 400
 *   3.  Invalid slug (uppercase letters) → 400
 *   4.  Invalid slug (trailing hyphen) → 400
 *   5.  Non-integer displayOrder → 400
 *   6.  Valid payload → 201
 *  15.  Duplicate slug within same rubric set → 409
 *  16.  Same slug in a different rubric set → 201 (allowed)
 *  19.  Two fresh domains in the SAME category with identical slugs → 409
 *
 * PUT /categories/:id
 *   7.  Non-string name (number) → 400
 *   8.  Non-integer displayOrder (string) → 400
 *   9.  Empty body → 400 "Nothing to update"
 *  10.  Valid name update → 200
 *
 * PUT /domains/:id
 *  11.  Invalid slug format → 400
 *  12.  Slug rename when observation_scores reference the old slug → 409
 *  13.  Slug rename when no scores reference the old slug → 200
 *  14.  Valid name-only update (no slug change) → 200
 *  17.  Rename to a slug already used by a sibling domain → 409
 *  18.  Direct DB INSERT with rubric_set_id = NULL is rejected (NOT NULL constraint)
 *        — proves legacy rows cannot bypass the duplicate-slug unique index
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { people, schools, rubricSets, rubricCategories, rubricDomains, observations, observationScores } from "@workspace/db/schema";
import { eq, asc, inArray, sql } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

/* ── Test entity IDs ──────────────────────────────────────────────────────── */

const ADMIN_EID = "TST_RUBRIC_VAL_ADMIN";
const ALL_EIDS  = [ADMIN_EID];

let SCHOOL_ID:   number;
let RUBRIC_ID:   number;
let CAT_ID:      number;
let DOMAIN_ID:   number;   // domain created in before(); used as target for most tests
let OBS_ID:      number;   // observation whose score row pins the slug in test 12

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

describe("Rubric category/domain mutation validation + slug-rename guard", () => {
  before(async () => {
    const [school] = await db
      .select({ id: schools.id })
      .from(schools)
      .orderBy(asc(schools.id))
      .limit(1);
    assert.ok(school, "Need at least one school in DB");
    SCHOOL_ID = school.id;

    /* Admin person */
    await db.insert(people).values({
      employeeId:               ADMIN_EID,
      firstName:                "Test",
      lastName:                 "RubricValAdmin",
      email:                    "tst.rubric.val.admin@example.com",
      role:                     "NETWORK_ADMIN",
      schoolId:                 null,
      isActive:                 true,
      includeInFeedbackTracker: false,
    }).onConflictDoNothing();

    /* Rubric set — created directly in DB so we can test categories/domains */
    const [rubric] = await db.insert(rubricSets).values({
      slug:         "TST-RUBRIC-VAL",
      name:         "Test Rubric Validation",
      isActive:     false,
      isArchived:   false,
      displayOrder: 9999,
    }).returning();
    RUBRIC_ID = rubric.id;

    /* A category to attach domains to */
    const [cat] = await db.insert(rubricCategories).values({
      rubricSetId:  RUBRIC_ID,
      name:         "Test Category Val",
      displayOrder: 0,
    }).returning();
    CAT_ID = cat.id;

    /* A domain used as the target for PUT /domains/:id tests */
    const [dom] = await db.insert(rubricDomains).values({
      categoryId:   CAT_ID,
      rubricSetId:  RUBRIC_ID,
      name:         "Test Domain Val",
      slug:         "tst-domain-val",
      displayOrder: 0,
    }).returning();
    DOMAIN_ID = dom.id;

    /* An observation + score row that references DOMAIN_ID's slug.
       This is the row that should block the slug rename in test 12. */
    const [obs] = await db.insert(observations).values({
      rubricSetId:        RUBRIC_ID,
      schoolId:           SCHOOL_ID,
      observedEmployeeId: null,
      observerEmployeeId: null,
      date:               "2025-01-01",
      observer:           "Test Observer",
      status:             "published",
      target:             "TEACHER",
    }).returning();
    OBS_ID = obs.id;

    await db.insert(observationScores).values({
      observationId: OBS_ID,
      domainSlug:    "tst-domain-val",
      score:         1,
    });
  });

  after(async () => {
    /* Clean up in FK-safe order */
    await db.delete(observationScores).where(eq(observationScores.observationId, OBS_ID)).catch(() => {});
    await db.delete(observations).where(eq(observations.id, OBS_ID)).catch(() => {});
    await db.delete(rubricSets).where(eq(rubricSets.id, RUBRIC_ID)).catch(() => {}); /* cascades domains/cats */
    await db.delete(people).where(inArray(people.employeeId, ALL_EIDS)).catch(() => {});
  });

  /* ── POST /categories/:id/domains ─────────────────────────────────────── */

  test("1 — POST /categories/:id/domains with missing name → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", `/rubric/categories/${CAT_ID}/domains`, { slug: "valid-slug" }, jar);
    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("2 — POST /categories/:id/domains with missing slug → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", `/rubric/categories/${CAT_ID}/domains`, { name: "No Slug Domain" }, jar);
    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("3 — POST /categories/:id/domains with uppercase slug → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", `/rubric/categories/${CAT_ID}/domains`, {
      name: "Bad Slug Domain", slug: "UPPERCASE-SLUG",
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for uppercase slug, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("4 — POST /categories/:id/domains with trailing-hyphen slug → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", `/rubric/categories/${CAT_ID}/domains`, {
      name: "Bad Slug Domain", slug: "bad-slug-",
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for trailing-hyphen slug, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("5 — POST /categories/:id/domains with non-integer displayOrder → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", `/rubric/categories/${CAT_ID}/domains`, {
      name: "Order Domain", slug: "order-domain", displayOrder: "not-a-number",
    }, jar);
    assert.equal(res.status, 400, `Expected 400 for string displayOrder, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("6 — POST /categories/:id/domains with valid payload → 201", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("POST", `/rubric/categories/${CAT_ID}/domains`, {
      name: "Valid New Domain", slug: "tst-valid-new", displayOrder: 99,
    }, jar);
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { slug?: string; name?: string };
    assert.equal(body.slug, "tst-valid-new");
    assert.equal(body.name, "Valid New Domain");
  });

  test("15 — POST /categories/:id/domains with duplicate slug in same rubric set → 409", async () => {
    const jar = await loginAs(ADMIN_EID);
    /* tst-domain-val already exists in RUBRIC_ID (created in before()) */
    const res = await request("POST", `/rubric/categories/${CAT_ID}/domains`, {
      name: "Duplicate Slug Domain", slug: "tst-domain-val",
    }, jar);
    assert.equal(res.status, 409, `Expected 409 for duplicate slug, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { error?: string };
    assert.ok(body.error?.includes("tst-domain-val"), `Error should mention the conflicting slug, got: ${body.error}`);
  });

  test("16 — POST /categories/:id/domains with same slug in a different rubric set → 201", async () => {
    const jar = await loginAs(ADMIN_EID);

    /* Create a second rubric set + category */
    const [rubric2] = await db.insert(rubricSets).values({
      slug:         "TST-RUBRIC-VAL-2",
      name:         "Test Rubric Validation 2",
      isActive:     false,
      isArchived:   false,
      displayOrder: 9998,
    }).returning();
    const [cat2] = await db.insert(rubricCategories).values({
      rubricSetId:  rubric2.id,
      name:         "Test Category Val 2",
      displayOrder: 0,
    }).returning();

    try {
      /* Using the same slug "tst-domain-val" in a *different* rubric set must succeed */
      const res = await request("POST", `/rubric/categories/${cat2.id}/domains`, {
        name: "Cross-set Allowed Domain", slug: "tst-domain-val",
      }, jar);
      assert.equal(res.status, 201, `Expected 201 for same slug in different rubric set, got ${res.status}: ${JSON.stringify(res.body)}`);
    } finally {
      await db.delete(rubricSets).where(eq(rubricSets.id, rubric2.id)).catch(() => {});
    }
  });

  test("19 — POST two fresh domains with identical slugs into the SAME category → 409 on second", async () => {
    const jar = await loginAs(ADMIN_EID);
    const slug = "tst-same-cat-dup-slug";

    /* First domain → must succeed */
    const first = await request("POST", `/rubric/categories/${CAT_ID}/domains`, {
      name: "Same-cat Dup Test Domain A", slug,
    }, jar);
    assert.equal(first.status, 201, `Expected 201 for first domain, got ${first.status}: ${JSON.stringify(first.body)}`);

    try {
      /* Second domain in the SAME category with the SAME slug → must be rejected */
      const second = await request("POST", `/rubric/categories/${CAT_ID}/domains`, {
        name: "Same-cat Dup Test Domain B", slug,
      }, jar);
      assert.equal(second.status, 409, `Expected 409 for same-category duplicate slug, got ${second.status}: ${JSON.stringify(second.body)}`);
      const body = second.body as { error?: string };
      assert.ok(body.error?.includes(slug), `Error message should mention the conflicting slug "${slug}", got: ${body.error}`);
    } finally {
      /* Clean up the first domain so it doesn't pollute later tests */
      const created = first.body as { id?: number };
      if (created.id != null) {
        await db.delete(rubricDomains).where(eq(rubricDomains.id, created.id)).catch(() => {});
      }
    }
  });

  /* ── PUT /categories/:id ──────────────────────────────────────────────── */

  test("7 — PUT /categories/:id with non-string name (number) → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PUT", `/rubric/categories/${CAT_ID}`, { name: 99 }, jar);
    assert.equal(res.status, 400, `Expected 400 for numeric name, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("8 — PUT /categories/:id with non-integer displayOrder (string) → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PUT", `/rubric/categories/${CAT_ID}`, { displayOrder: "first" }, jar);
    assert.equal(res.status, 400, `Expected 400 for string displayOrder, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("9 — PUT /categories/:id with empty body → 400 'Nothing to update'", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PUT", `/rubric/categories/${CAT_ID}`, {}, jar);
    assert.equal(res.status, 400, `Expected 400 for empty body, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(
      JSON.stringify(res.body).toLowerCase().includes("nothing"),
      `Expected 'Nothing to update' message, got: ${JSON.stringify(res.body)}`,
    );
  });

  test("10 — PUT /categories/:id with valid name → 200", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PUT", `/rubric/categories/${CAT_ID}`, { name: "Updated Category Name" }, jar);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { name?: string };
    assert.equal(body.name, "Updated Category Name");
  });

  /* ── PUT /domains/:id ─────────────────────────────────────────────────── */

  test("11 — PUT /domains/:id with invalid slug format → 400", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PUT", `/rubric/domains/${DOMAIN_ID}`, { slug: "UPPER_CASE" }, jar);
    assert.equal(res.status, 400, `Expected 400 for invalid slug, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("12 — PUT /domains/:id slug rename when scores exist → 409 with count", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PUT", `/rubric/domains/${DOMAIN_ID}`, { slug: "tst-domain-renamed" }, jar);
    assert.equal(res.status, 409, `Expected 409 for slug rename with scores, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { error?: string };
    assert.ok(body.error?.includes("tst-domain-val"), `Error should mention old slug, got: ${body.error}`);
    assert.ok(body.error?.includes("observation score"), `Error should mention observation score rows, got: ${body.error}`);
  });

  test("13 — PUT /domains/:id slug rename when no scores reference it → 200", async () => {
    const jar = await loginAs(ADMIN_EID);
    /* First POST a fresh domain with no scores attached */
    const createRes = await request("POST", `/rubric/categories/${CAT_ID}/domains`, {
      name: "Rename-safe Domain", slug: "tst-rename-safe", displayOrder: 0,
    }, jar);
    assert.equal(createRes.status, 201, `Setup: Expected 201, got ${createRes.status}`);
    const newDomain = createRes.body as { id: number };
    assert.ok(newDomain.id, "Expected domain id in response");

    const res = await request("PUT", `/rubric/domains/${newDomain.id}`, { slug: "tst-rename-ok" }, jar);
    assert.equal(res.status, 200, `Expected 200 for slug rename with no scores, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { slug?: string };
    assert.equal(body.slug, "tst-rename-ok");
  });

  test("14 — PUT /domains/:id name-only update (no slug change) → 200", async () => {
    const jar = await loginAs(ADMIN_EID);
    const res = await request("PUT", `/rubric/domains/${DOMAIN_ID}`, { name: "Updated Domain Name" }, jar);
    assert.equal(res.status, 200, `Expected 200 for name update, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { name?: string; slug?: string };
    assert.equal(body.name, "Updated Domain Name");
    assert.equal(body.slug, "tst-domain-val", "Slug should remain unchanged");
  });

  test("17 — PUT /domains/:id rename to a slug already used by a sibling domain → 409", async () => {
    const jar = await loginAs(ADMIN_EID);

    /* Create a second domain in the same category (same rubric set) with a known slug */
    const createRes = await request("POST", `/rubric/categories/${CAT_ID}/domains`, {
      name: "Sibling Domain For Conflict", slug: "tst-sibling-slug",
    }, jar);
    assert.equal(createRes.status, 201, `Setup: Expected 201, got ${createRes.status}`);
    const sibling = createRes.body as { id: number };

    try {
      /* Now try to rename sibling to "tst-domain-val" which is already taken by DOMAIN_ID */
      const res = await request("PUT", `/rubric/domains/${sibling.id}`, { slug: "tst-domain-val" }, jar);
      assert.equal(res.status, 409, `Expected 409 for rename to sibling's slug, got ${res.status}: ${JSON.stringify(res.body)}`);
      const body = res.body as { error?: string };
      assert.ok(body.error?.includes("tst-domain-val"), `Error should mention the conflicting slug, got: ${body.error}`);
    } finally {
      await db.delete(rubricDomains).where(eq(rubricDomains.id, sibling.id)).catch(() => {});
    }
  });

  test("18 — Direct DB INSERT with rubric_set_id = NULL is rejected by NOT NULL constraint", async () => {
    /* Regression test: rubric_domains.rubric_set_id was historically nullable.
       Legacy rows with NULL rubric_set_id could bypass the (rubric_set_id, slug)
       unique index and the application-level duplicate check.
       After the backfill migration + NOT NULL constraint, the DB must reject any
       attempt to insert a domain without rubric_set_id — closing the bypass gap. */
    let threw = false;
    try {
      await db.execute(sql`
        INSERT INTO rubric_domains (category_id, name, slug, display_order, rubric_set_id)
        VALUES (${CAT_ID}, 'Legacy Null Domain', 'tst-null-rubric-set', 0, NULL)
      `);
    } catch (err: unknown) {
      threw = true;
      /* Drizzle wraps the pg error; the NOT NULL code 23502 may live on
         the top-level error, its cause, or any nested cause. Serialize
         the full chain so we can assert on the constraint code. */
      const chain = JSON.stringify(err, Object.getOwnPropertyNames(err instanceof Error ? err : {}));
      const cause  = (err as { cause?: unknown }).cause;
      const causeStr = cause ? JSON.stringify(cause, Object.getOwnPropertyNames(cause instanceof Error ? cause : {})) : "";
      const combined = chain + causeStr;
      assert.ok(
        combined.includes("23502") || combined.includes("null value") || combined.includes("not-null") || combined.includes("violates not-null"),
        `Expected a NOT NULL constraint violation (pg code 23502), got: ${combined}`,
      );
    }
    assert.ok(threw, "Expected DB to throw on INSERT with rubric_set_id = NULL, but it succeeded — NOT NULL constraint is not in place!");
  });
});

process.on("exit", () => { pool.end().catch(() => {}); });
