/**
 * Regression test: the rubric set cap is per school year.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:rubric-set-cap-per-year
 *
 * Requires the dev server (NODE_ENV=development) for /api/auth/dev-login.
 *
 * Reported from the live site on 2026-08-21: creating a rubric set did
 * nothing, with no error on screen. Five were listed, the cap is six.
 *
 * Two rules disagreed. GET /rubric/sets lists only the ACTIVE year, so the
 * screen showed five. The cap counted every non-archived set in EVERY year,
 * and a rubric copied forward into next year — invisible on that screen —
 * was quietly using up the sixth slot. The user could see one number and was
 * being refused by another.
 *
 * These tests build their own years so they do not depend on what happens to
 * be in the database.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { rubricSets, schoolYears } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { MAX_ACTIVE_SETS } from "./lib/rubric-constants.js";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;
const ADMIN_EID = "U10";
const STAMP = Date.now();

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
  assert.equal(res.status, 200, `dev-login failed: ${res.status}`);
  return { cookieHeader: res.headers.get("set-cookie")!.split(";")[0]! };
}

let adminJar: Jar;
let fullYearId: number;
let emptyYearId: number;
const createdSlugs: string[] = [];

describe("Rubric set cap is per school year", () => {
  before(async () => {
    adminJar = await loginAs(ADMIN_EID);

    const [full] = await db.insert(schoolYears).values({
      name: `TST Cap Full ${STAMP}`, status: "inactive", displayOrder: 9998,
    }).returning({ id: schoolYears.id });
    fullYearId = full!.id;

    const [empty] = await db.insert(schoolYears).values({
      name: `TST Cap Empty ${STAMP}`, status: "inactive", displayOrder: 9999,
    }).returning({ id: schoolYears.id });
    emptyYearId = empty!.id;

    /* Fill the first year exactly to the cap, inserted directly so the
       endpoint's own limit does not get in the way of the setup. */
    for (let i = 0; i < MAX_ACTIVE_SETS; i++) {
      const slug = `TSTCAP${i}`;
      await db.insert(rubricSets).values({
        slug, name: `Cap Filler ${i}`, schoolYearId: fullYearId,
        isArchived: false, displayOrder: 900 + i,
      });
      createdSlugs.push(slug);
    }
  });

  after(async () => {
    await db.delete(rubricSets).where(inArray(rubricSets.schoolYearId, [fullYearId, emptyYearId])).catch(() => {});
    if (createdSlugs.length) {
      await db.delete(rubricSets).where(inArray(rubricSets.slug, createdSlugs)).catch(() => {});
    }
    await db.delete(schoolYears).where(inArray(schoolYears.id, [fullYearId, emptyYearId])).catch(() => {});
    await pool.end().catch(() => {});
  });

  test("1 — a year at the cap refuses another set", async () => {
    const res = await request("POST", "/rubric/sets", {
      slug: "TSTCAPX", name: "One Too Many", schoolYearId: fullYearId,
    }, adminJar);
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(String(res.body.error), /maximum/i);
    assert.match(String(res.body.error), /school year/i,
      "the message should say the limit is per year, or it reads as a global cap again");
  });

  test("2 — a DIFFERENT year is unaffected by the first being full", async () => {
    /* The regression. Before the fix the count was global, so six sets in one
       year blocked creation in every other year — including the active one,
       which is how five visible rubrics turned into "maximum reached". */
    const slug = `TSTCAPOK${STAMP % 100}`.slice(0, 8);
    const res = await request("POST", "/rubric/sets", {
      slug, name: "Different Year", schoolYearId: emptyYearId,
    }, adminJar);
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    createdSlugs.push(slug);
  });

  test("3 — archived sets do not count against the cap", async () => {
    /* The documented way out of the limit: archive one, create another. */
    const [first] = await db.select({ id: rubricSets.id }).from(rubricSets)
      .where(eq(rubricSets.schoolYearId, fullYearId)).limit(1);
    await db.update(rubricSets).set({ isArchived: true }).where(eq(rubricSets.id, first!.id));

    const slug = `TSTCAPY${STAMP % 10}`.slice(0, 8);
    const res = await request("POST", "/rubric/sets", {
      slug, name: "After Archiving", schoolYearId: fullYearId,
    }, adminJar);
    assert.equal(res.status, 201, `expected 201 after archiving, got ${res.status}: ${JSON.stringify(res.body)}`);
    createdSlugs.push(slug);
  });
});
