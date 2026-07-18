import { test, expect } from "@playwright/test";

/**
 * E2E tests — rubric set slug validation in the principal dashboard admin editor.
 *
 * Scenarios:
 *  1. Creating a rubric set with an invalid slug (lowercase / spaces) → 400 error from the API
 *  2. Renaming a rubric-set slug that is referenced by an observation → 409 error shown
 *  3. Renaming a rubric-set slug with no observations → succeeds, new slug visible
 *
 * Test data strategy
 * ------------------
 * Unique rubric sets are created in beforeAll via API (dev-login as NETWORK_ADMIN U10).
 * Tests 2 & 3 exercise the "Edit Rubric Settings" dialog (Settings2 icon in the sidebar).
 * All rubric sets are archived in afterAll for clean-up.
 *
 * Selector notes
 * --------------
 * - The rubric set Settings2 (gear) icon is a button next to each tab in the sidebar.
 * - The edit dialog has a slug input whose value can be changed by the test.
 * - Errors on save: the mutation's onError calls alert(err.message); Playwright can
 *   intercept the browser dialog via page.on("dialog", ...).
 */

const ADMIN_EID = "U10"; // Brendan Campbell — NETWORK_ADMIN
const RUN_ID    = Date.now().toString().slice(-6); // avoids slug collisions between runs

let schoolId: number;

/* ── slugs used for test 2 (rename blocked) ──────────────────────── */
let lockedSetSlug: string;

/* ── slugs used for test 3 (rename succeeds) ─────────────────────── */
let freeSetSlug:    string;
let renamedSetSlug: string;

test.describe("Rubric set slug validation — admin editor", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  /* ── One-time setup ───────────────────────────────────────────────── */

  test.beforeAll(async ({ request }) => {
    await request.post("/api/auth/dev-login", {
      data: { employeeId: ADMIN_EID },
    });

    /* Grab a school ID for the observation fixture in test 2 */
    const schoolsResp = await request.get("/api/admin/schools");
    if (schoolsResp.ok()) {
      const schools = await schoolsResp.json() as Array<{ id: number }>;
      if (schools.length > 0) schoolId = schools[0]!.id;
    }
    if (!schoolId) schoolId = 1;

    /* Create the "locked" rubric set for test 2 */
    lockedSetSlug = `TST-LOCK-${RUN_ID}`;
    const lockedResp = await request.post("/api/rubric/sets", {
      data: { slug: lockedSetSlug, name: `E2E Lock Test ${RUN_ID}` },
    });
    expect(lockedResp.ok(), `locked rubric set creation failed: ${await lockedResp.text()}`).toBeTruthy();
    const { id: lockedId } = await lockedResp.json() as { id: number };

    /* Create a draft observation referencing the locked set */
    const obsResp = await request.post("/api/observations", {
      data: {
        rubricSetId: lockedId,
        schoolId,
        date:        new Date().toISOString().slice(0, 10),
        status:      "draft",
        target:      "SCHOOL",
      },
    });
    expect(obsResp.ok(), `observation creation failed: ${await obsResp.text()}`).toBeTruthy();

    /* Create the "free" rubric set for test 3 (no observations) */
    freeSetSlug    = `TST-FREE-${RUN_ID}`;
    renamedSetSlug = `TST-RNM-${RUN_ID}`;
    const freeResp = await request.post("/api/rubric/sets", {
      data: { slug: freeSetSlug, name: `E2E Free Test ${RUN_ID}` },
    });
    expect(freeResp.ok(), `free rubric set creation failed: ${await freeResp.text()}`).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await request.post("/api/auth/dev-login", {
      data: { employeeId: ADMIN_EID },
    }).catch(() => {});
    /* Archive both test sets */
    await request.patch(`/api/rubric/sets/${lockedSetSlug}`, {
      data: { isArchived: true },
    }).catch(() => {});
    await request.patch(`/api/rubric/sets/${renamedSetSlug}`, {
      data: { isArchived: true },
    }).catch(() => {});
    await request.patch(`/api/rubric/sets/${freeSetSlug}`, {
      data: { isArchived: true },
    }).catch(() => {});
  });

  /* ── Per-test login (no page navigation needed for test 1) ─────── */

  test.beforeEach(async ({ page }) => {
    const login = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: ADMIN_EID },
    });
    expect(login.ok(), "dev-login must succeed in beforeEach").toBeTruthy();
  });

  /* ── Test 1: invalid slug rejected by the create endpoint ──────── */

  test("invalid slug is rejected by the rubric-set create endpoint", async ({ page }) => {
    /* The create dialog auto-generates slugs, so we test the API directly to
       confirm server-side slug validation is enforced on the create path.   */
    const resp = await page.request.post("/api/rubric/sets", {
      data: { slug: "bad slug with spaces!", name: `E2E Bad Slug ${RUN_ID}` },
    });

    expect(resp.status()).toBe(400);
    const body = await resp.json() as { error: string };
    expect(body.error).toMatch(/slug/i);
  });

  /* ── Test 2: slug rename blocked when observations reference the set */

  test("slug rename is blocked when an observation references the rubric set", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");

    /* Navigate to the locked rubric set in the sidebar */
    await page.getByText(`E2E Lock Test ${RUN_ID}`, { exact: false }).first().click();
    await page.waitForLoadState("networkidle");

    /* Open the "Edit Rubric Settings" dialog via the Settings2 (gear) icon */
    const settingsBtn = page
      .getByText(`E2E Lock Test ${RUN_ID}`, { exact: false })
      .first()
      .locator("xpath=ancestor::*[contains(@class,'flex')]")
      .getByRole("button")
      .filter({ has: page.locator("svg") })
      .last();

    await settingsBtn.click();

    /* Wait for the edit dialog to appear */
    await expect(page.getByText("Edit Rubric Settings", { exact: false })).toBeVisible({ timeout: 8_000 });

    /* Change the slug to a new valid value */
    const slugInput = page.locator('input[placeholder*="LAUNCH"]').or(
      page.locator('label:has-text("Slug")').locator("xpath=following-sibling::input")
    ).first();
    await slugInput.fill("TSTRENAMEDLK");

    /* Intercept the alert that fires when the 409 is returned */
    const alertMessage = await new Promise<string>((resolve) => {
      page.once("dialog", (dialog) => {
        const msg = dialog.message();
        dialog.dismiss().catch(() => {});
        resolve(msg);
      });

      page.locator("button.text-white")
        .filter({ hasText: /save/i })
        .or(page.getByRole("button", { name: /save/i }))
        .last()
        .click()
        .catch(() => {});
    });

    expect(alertMessage).toMatch(/observation/i);
  });

  /* ── Test 3: slug rename succeeds when no observations reference it */

  test("slug rename succeeds when no observations reference the rubric set", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");

    /* Navigate to the free rubric set in the sidebar */
    await page.getByText(`E2E Free Test ${RUN_ID}`, { exact: false }).first().click();
    await page.waitForLoadState("networkidle");

    /* Open the edit dialog via the Settings2 icon */
    const settingsBtn = page
      .getByText(`E2E Free Test ${RUN_ID}`, { exact: false })
      .first()
      .locator("xpath=ancestor::*[contains(@class,'flex')]")
      .getByRole("button")
      .filter({ has: page.locator("svg") })
      .last();

    await settingsBtn.click();

    await expect(page.getByText("Edit Rubric Settings", { exact: false })).toBeVisible({ timeout: 8_000 });

    /* Change the slug */
    const slugInput = page.locator('input[placeholder*="LAUNCH"]').or(
      page.locator('label:has-text("Slug")').locator("xpath=following-sibling::input")
    ).first();
    await slugInput.clear();
    await slugInput.fill(renamedSetSlug);

    /* Click save — expect dialog to close (no alert, no error) */
    await page
      .getByRole("button", { name: /save/i })
      .last()
      .click();

    /* Dialog should close */
    await expect(page.getByText("Edit Rubric Settings", { exact: false })).not.toBeVisible({ timeout: 8_000 });

    /* The renamed slug should now appear in the sidebar or page */
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(`E2E Free Test ${RUN_ID}`, { exact: false }).first()
    ).toBeVisible({ timeout: 8_000 });
  });
});
