/**
 * Integration tests: starting a rubric from an existing one carries the
 * domain descriptions.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:rubric-copy-descriptions
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * A domain's description is the hover text an observer reads to know what the
 * domain actually means. Two paths copy a rubric — copyFromSlug when creating
 * a new one, and copy-forward at a rollover — and only copy-forward carried
 * it. So building this year's rubric from last year's looked right and had
 * lost every piece of guidance.
 *
 *   1. copyFromSlug carries each domain's description
 *   2. It still carries the names, slugs and order
 *   3. A domain with no description stays empty rather than becoming a string
 *   4. copy-forward carries them too (it always did — this pins it)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { schoolYears, rubricSets, rubricCategories, rubricDomains } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;

const STAMP     = Date.now();
const ADMIN_EID = "U10";
const SOURCE_SLUG = `TSTCPYSRC${STAMP}`;
const COPY_SLUG   = `TSTCPYDST${STAMP}`;

const DESC_A = "Teacher circulates with purpose during independent work.";
const DESC_B = "Questions push students beyond recall.";

type Jar = { cookieHeader: string };

async function request(method: string, path: string, body: unknown, jar: Jar) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: jar.cookieHeader },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: parsed as any };
}

async function loginAs(employeeId: string): Promise<Jar> {
  const res = await fetch(`${BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  assert.equal(res.status, 200, `dev-login failed for ${employeeId}: ${res.status}`);
  return { cookieHeader: res.headers.get("set-cookie")!.split(";")[0]! };
}

async function domainsOf(slug: string) {
  const [set] = await db.select({ id: rubricSets.id }).from(rubricSets)
    .where(eq(rubricSets.slug, slug)).limit(1);
  assert.ok(set, `rubric set ${slug} should exist`);
  return db.select({
    name: rubricDomains.name, slug: rubricDomains.slug,
    description: rubricDomains.description, displayOrder: rubricDomains.displayOrder,
  }).from(rubricDomains).where(eq(rubricDomains.rubricSetId, set.id))
    .orderBy(rubricDomains.displayOrder);
}

let adminJar: Jar;
let yearId: number;
const createdSetIds: number[] = [];

describe("Copying a rubric carries the hover text", () => {
  before(async () => {
    const [year] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "active")).limit(1);
    assert.ok(year, "Need an active school year");
    yearId = year.id;

    adminJar = await loginAs(ADMIN_EID);

    /* A source rubric with two described domains and one with none. */
    const [src] = await db.insert(rubricSets)
      .values({ slug: SOURCE_SLUG, name: "Copy Source", target: "TEACHER",
                isActive: false, schoolYearId: yearId })
      .returning({ id: rubricSets.id });
    assert.ok(src);
    createdSetIds.push(src.id);

    const [cat] = await db.insert(rubricCategories)
      .values({ rubricSetId: src.id, name: "Instruction", displayOrder: 1 })
      .returning({ id: rubricCategories.id });
    assert.ok(cat);

    await db.insert(rubricDomains).values([
      { categoryId: cat.id, rubricSetId: src.id, schoolYearId: yearId,
        slug: `tst-cpy-a-${STAMP}`, name: "Circulation", displayOrder: 1, description: DESC_A },
      { categoryId: cat.id, rubricSetId: src.id, schoolYearId: yearId,
        slug: `tst-cpy-b-${STAMP}`, name: "Questioning", displayOrder: 2, description: DESC_B },
      { categoryId: cat.id, rubricSetId: src.id, schoolYearId: yearId,
        slug: `tst-cpy-c-${STAMP}`, name: "Undescribed", displayOrder: 3, description: null },
    ]);
  });

  after(async () => {
    if (createdSetIds.length > 0) {
      await db.delete(rubricSets).where(inArray(rubricSets.id, createdSetIds)).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  test("1 — copyFromSlug carries each domain's description", async () => {
    const res = await request("POST", "/rubric/sets", {
      slug: COPY_SLUG, name: "Copy Destination", copyFromSlug: SOURCE_SLUG,
    }, adminJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
    createdSetIds.push(Number(res.body.id));

    const domains = await domainsOf(COPY_SLUG);
    assert.equal(domains.length, 3, "all three domains should come across");

    const byName = new Map(domains.map((d) => [d.name, d]));
    assert.equal(byName.get("Circulation")!.description, DESC_A,
      "the hover text is the point of the domain — it has to come with it");
    assert.equal(byName.get("Questioning")!.description, DESC_B);
  });

  test("2 — names, slugs and order still come across", async () => {
    const domains = await domainsOf(COPY_SLUG);
    assert.deepEqual(domains.map((d) => d.name), ["Circulation", "Questioning", "Undescribed"]);
    assert.deepEqual(domains.map((d) => d.displayOrder), [1, 2, 3]);
    assert.ok(domains.every((d) => d.slug.startsWith("tst-cpy-")), "slugs are carried, not regenerated");
  });

  test("3 — a domain with no description stays empty", async () => {
    const domains = await domainsOf(COPY_SLUG);
    const undescribed = domains.find((d) => d.name === "Undescribed");
    assert.ok(undescribed);
    assert.equal(undescribed!.description, null,
      "copying must not invent a description where there was none");
  });

  test("4 — copy-forward carries them too", async () => {
    /* This path always worked. Pinned so the two copy routes cannot drift
       apart again — that divergence is what made the bug invisible. */
    const [other] = await db.select({ id: schoolYears.id }).from(schoolYears)
      .where(eq(schoolYears.status, "inactive")).limit(1);
    if (!other) return;   /* single-year database: nothing to copy forward into */

    const [src] = await db.select({ id: rubricSets.id }).from(rubricSets)
      .where(eq(rubricSets.slug, SOURCE_SLUG)).limit(1);
    assert.ok(src);

    const res = await request("POST", `/rubric/sets/${src.id}/copy-forward`,
      { targetSchoolYearId: other.id }, adminJar);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
    const newId = Number(res.body.id);
    createdSetIds.push(newId);

    const copied = await db.select({ name: rubricDomains.name, description: rubricDomains.description })
      .from(rubricDomains).where(eq(rubricDomains.rubricSetId, newId));
    const byName = new Map(copied.map((d) => [d.name, d.description]));
    assert.equal(byName.get("Circulation"), DESC_A);
    assert.equal(byName.get("Questioning"), DESC_B);
  });
});
