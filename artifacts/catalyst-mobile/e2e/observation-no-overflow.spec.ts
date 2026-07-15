/**
 * observation-no-overflow.spec.ts
 *
 * Confirms the mobile observation form renders without horizontal overflow on
 * narrow phone viewports (390 px and 320 px wide).
 *
 * What is checked
 * ---------------
 * 1. The form root (#obs-form) — scrollWidth must not exceed its clientWidth.
 * 2. Every <input type="date"> on the page — individually verified to fit
 *    within its own container (covers the observation-date and action-step
 *    due-date inputs from lines 671-685 and 930-993 of observation.tsx).
 * 3. The action-step section (blue card, .bg-blue-50) — must not overflow.
 *
 * How it works
 * ------------
 * - dev-login as a NETWORK_ADMIN (U10 — Brendan Campbell, active in dev DB).
 *   NETWORK_ADMIN is used because the SCHOOL_LEADER test users in this dev DB
 *   have no schoolId assigned, which causes /api/people to return 403.
 * - GET /api/rubric/sets to obtain a live, non-archived rubric.
 * - Seed localStorage with BOTH the selected rubric AND the selected school
 *   (required for NETWORK_ADMIN users — isNetworkScope = true, so the page
 *   redirects to /school-picker when no school is stored).
 * - Navigate to /catalyst-mobile/observation.
 * - Wait for #obs-form, then measure scrollWidth vs clientWidth at each viewport.
 *
 * Test data
 * ---------
 * - Observer  : U10 (Brendan Campbell, NETWORK_ADMIN)
 * - School     : id=14, "Camden Prep Copewood MS"
 * - Rubric     : first non-archived set returned by /api/rubric/sets
 *
 * Reference: artifacts/catalyst-mobile/src/pages/observation.tsx (lines 671-685, 930-993)
 */

import { test, expect } from "@playwright/test";

const LOGIN_EMPLOYEE_ID = "U10"; // Brendan Campbell — NETWORK_ADMIN (active in dev DB)

const SCHOOL_LS_KEY = "catalyst-mobile-selected-school";
const RUBRIC_LS_KEY = "catalyst-mobile-selected-rubric";

/** School used for the test — must exist in the dev database. */
const TEST_SCHOOL = { id: 14, displayName: "Camden Prep Copewood MS" };

const NARROW_VIEWPORTS = [
  { width: 390, height: 844, label: "390 × 844 (iPhone 14)" },
  { width: 320, height: 568, label: "320 × 568 (iPhone SE 1st gen)" },
] as const;

/** Checks whether an element's scrollWidth exceeds its clientWidth. */
async function hasHorizontalOverflow(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<{ overflows: boolean; scrollWidth: number; clientWidth: number }> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { overflows: true, scrollWidth: -1, clientWidth: -1 };
    return {
      overflows: el.scrollWidth > el.clientWidth,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    };
  }, selector);
}

/** Returns overflow info for every element matching the selector. */
async function allElementsOverflow(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<Array<{ index: number; overflows: boolean; scrollWidth: number; clientWidth: number }>> {
  return page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel)).map((el, index) => ({
      index,
      overflows: el.scrollWidth > el.clientWidth,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
  }, selector);
}

for (const vp of NARROW_VIEWPORTS) {
  test.describe(`Observation form — no horizontal overflow at ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      // 1. Authenticate via dev-login (sets session cookie on the page context).
      //    The Vite dev server proxies /api → localhost:8080 so the cookie
      //    is issued for the Vite origin (127.0.0.1:PORT) and travels with
      //    every subsequent page request through the proxy.
      const loginResp = await page.request.post("/api/auth/dev-login", {
        data: { employeeId: LOGIN_EMPLOYEE_ID },
      });
      expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();
      const loginBody = await loginResp.json();
      expect(loginBody.ok, "dev-login body.ok must be true").toBe(true);

      // 2. Fetch an active rubric set to seed into localStorage.
      const rubricsResp = await page.request.get("/api/rubric/sets");
      expect(rubricsResp.ok(), "rubric sets fetch must succeed").toBeTruthy();
      const rubricSets: Array<{ id: number; slug: string; name: string; isArchived?: boolean }> =
        await rubricsResp.json();
      const rubric = rubricSets.find((r) => !r.isArchived) ?? rubricSets[0];
      expect(rubric, "at least one rubric set must exist").toBeTruthy();

      // 3. Open the mobile app root so that localStorage.setItem writes to the
      //    correct origin (127.0.0.1:PORT).  The Vite SPA serves index.html for
      //    any path, so /catalyst-mobile/ lands on the React shell.
      await page.goto("/catalyst-mobile/");

      // 4. Seed localStorage with selected school + rubric.
      //    NETWORK_ADMIN users are "network scope" — the observation page
      //    redirects to /school-picker when no school is stored.
      await page.evaluate(
        ([schoolKey, schoolData, rubricKey, rubricData]) => {
          localStorage.setItem(schoolKey as string, JSON.stringify(schoolData));
          localStorage.setItem(rubricKey as string, JSON.stringify(rubricData));
        },
        [SCHOOL_LS_KEY, TEST_SCHOOL, RUBRIC_LS_KEY, rubric] as const,
      );

      // 5. Navigate to the observation page.
      await page.goto("/catalyst-mobile/observation");

      // 6. Wait for the form to be present in the DOM (rubric + teachers loaded).
      await expect(page.locator("#obs-form")).toBeVisible({ timeout: 20_000 });
    });

    // ── Test 1: form root ────────────────────────────────────────────────────
    test("form root (#obs-form) has no horizontal overflow", async ({ page }) => {
      const result = await hasHorizontalOverflow(page, "#obs-form");
      expect(
        result.overflows,
        `#obs-form overflows at ${vp.width}px: scrollWidth=${result.scrollWidth}, clientWidth=${result.clientWidth}`,
      ).toBe(false);
    });

    // ── Test 2: date inputs ──────────────────────────────────────────────────
    test("all date inputs fit within their containers", async ({ page }) => {
      const results = await allElementsOverflow(page, 'input[type="date"]');
      expect(results.length, "at least one date input should be present").toBeGreaterThan(0);

      for (const r of results) {
        expect(
          r.overflows,
          `date input[${r.index}] overflows at ${vp.width}px: scrollWidth=${r.scrollWidth}, clientWidth=${r.clientWidth}`,
        ).toBe(false);
      }
    });

    // ── Test 3: action step section ──────────────────────────────────────────
    test("action step section has no horizontal overflow", async ({ page }) => {
      // The action-step card is uniquely identified by bg-blue-50 and contains
      // the action-step textarea and due-date input (observation.tsx lines 930-990).
      const actionSection = page.locator(".bg-blue-50").first();
      await expect(actionSection).toBeVisible({ timeout: 10_000 });

      const result = await actionSection.evaluate((el) => ({
        overflows: el.scrollWidth > el.clientWidth,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));

      expect(
        result.overflows,
        `action step section overflows at ${vp.width}px: scrollWidth=${result.scrollWidth}, clientWidth=${result.clientWidth}`,
      ).toBe(false);
    });
  });
}
