import { test, expect } from "@playwright/test";

/**
 * E2E tests — rubric domain slug validation in the principal dashboard admin editor.
 *
 * Scenarios:
 *  1. Adding a domain with an uppercase slug → inline error shown in the UI
 *  2. Renaming a domain slug that is referenced by an observation score → 409 error shown
 *  3. Renaming a domain slug with no observation scores → succeeds, new slug appears
 *
 * Test data strategy
 * ------------------
 * A unique rubric set is created in beforeAll via API (dev-login as NETWORK_ADMIN U10).
 * Each test creates its domain(s) via the same API session, then exercises the editor UI
 * through the browser page.  The rubric set is archived in afterAll for clean-up.
 *
 * Selector notes
 * --------------
 * - Domain slugs appear in <code> elements inside the domain row.
 * - The pencil (edit) button is the FIRST button in the flex row that contains the
 *   <code> slug element (xpath ancestor search to the "items-start" flex container).
 * - Inline errors: <p class="... text-red-600 ..."> rendered by addDomError / updDomError.
 * - Save button in edit mode: <button class="text-green-600 ..."> (Check icon).
 */

const ADMIN_EID = "U10"; // Brendan Campbell — NETWORK_ADMIN
const RUN_ID    = Date.now().toString().slice(-6); // avoids slug collisions between runs

let rubricSlug: string;
let rubricId:   number;
let catId:      number;
let schoolId:   number;

test.describe("Rubric domain slug validation — admin editor", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  /* ── One-time setup ───────────────────────────────────────────────────── */

  test.beforeAll(async ({ request }) => {
    /* Login with the shared API request context */
    const login = await request.post("/api/auth/dev-login", {
      data: { employeeId: ADMIN_EID },
    });
    expect(login.ok(), `dev-login failed: ${await login.text()}`).toBeTruthy();

    /* Create the test rubric set */
    rubricSlug = `TST-E2E-${RUN_ID}`;
    const setResp = await request.post("/api/rubric/sets", {
      data: { slug: rubricSlug, name: `E2E Slug Test ${RUN_ID}` },
    });
    expect(setResp.ok(), `rubric set creation failed: ${await setResp.text()}`).toBeTruthy();
    rubricId = (await setResp.json() as { id: number }).id;

    /* Create one category in that set */
    const catResp = await request.post(`/api/rubric/${rubricSlug}/categories`, {
      data: { name: "E2E Category", displayOrder: 0 },
    });
    expect(catResp.ok(), `category creation failed: ${await catResp.text()}`).toBeTruthy();
    catId = (await catResp.json() as { id: number }).id;

    /* Grab a school ID for the observation fixture in test 2 */
    const schoolsResp = await request.get("/api/admin/schools");
    if (schoolsResp.ok()) {
      const schools = await schoolsResp.json() as Array<{ id: number }>;
      if (schools.length > 0) schoolId = schools[0]!.id;
    }
    if (!schoolId) schoolId = 1; // safe fallback
  });

  test.afterAll(async ({ request }) => {
    /* Re-login (afterAll gets a fresh request context) */
    await request.post("/api/auth/dev-login", {
      data: { employeeId: ADMIN_EID },
    }).catch(() => {});
    /* Archive so the test rubric set no longer appears in the production sidebar */
    await request.patch(`/api/rubric/sets/${rubricSlug}`, {
      data: { isArchived: true },
    }).catch(() => {});
  });

  /* ── Per-test setup: login + navigate to admin ────────────────────────── */

  test.beforeEach(async ({ page }) => {
    const login = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: ADMIN_EID },
    });
    expect(login.ok(), "dev-login must succeed in beforeEach").toBeTruthy();

    await page.goto("/admin");
    await page.waitForLoadState("networkidle");

    /* Click our test rubric set in the left sidebar to load its categories */
    await page.getByText(`E2E Slug Test ${RUN_ID}`, { exact: false })
      .first()
      .click();
    await page.waitForLoadState("networkidle");
  });

  /* ── Test 1: uppercase slug rejected ─────────────────────────────────── */

  test("uppercase slug is rejected with an inline error", async ({ page }) => {
    /* Open the add-domain form for the first (and only) category */
    await page.getByText("Add domain").first().click();

    /* Fill in a name and manually override the slug with UPPERCASE characters */
    await page.getByPlaceholder("Domain name").fill("Bad Slug Domain");
    await page.getByPlaceholder("slug").first().fill("UPPERCASE-SLUG");

    /* Submit */
    await page.getByRole("button", { name: "Add", exact: true }).click();

    /* Inline red error paragraph must appear */
    const errMsg = page.locator("p.text-red-600").first();
    await expect(errMsg).toBeVisible({ timeout: 8_000 });
    await expect(errMsg).toContainText(/slug/i);
  });

  /* ── Test 2: slug rename blocked by observation score ─────────────────── */

  test("slug rename is blocked when an observation score references it", async ({ page }) => {
    const lockedSlug = `e2e-locked-${RUN_ID}`;

    /* Create the domain via API using the page's authenticated session */
    const domResp = await page.request.post(
      `/api/rubric/categories/${catId}/domains`,
      { data: { name: "Score-Locked Domain", slug: lockedSlug, displayOrder: 0 } },
    );
    expect(domResp.ok(), `domain creation failed: ${await domResp.text()}`).toBeTruthy();

    /* Create a draft observation with a score that pins the slug */
    const obsResp = await page.request.post("/api/observations", {
      data: {
        rubricSetId: rubricId,
        schoolId,
        date:        new Date().toISOString().slice(0, 10),
        status:      "draft",
        target:      "SCHOOL",
        scores:      { [lockedSlug]: 1 },
      },
    });
    expect(obsResp.ok(), `observation creation failed: ${await obsResp.text()}`).toBeTruthy();

    /* Reload so the newly-created domain is visible in the editor */
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByText(`E2E Slug Test ${RUN_ID}`, { exact: false }).first().click();
    await page.waitForLoadState("networkidle");

    /* Find the domain row via its slug <code> element and click the pencil */
    const slugCode = page.locator("code").filter({ hasText: lockedSlug });
    await expect(slugCode).toBeVisible({ timeout: 10_000 });
    await slugCode
      .locator("xpath=ancestor::div[contains(@class,'items-start')]")
      .getByRole("button")
      .first()
      .click();

    /* Change the slug to something new and save */
    await page.getByPlaceholder("slug").fill("e2e-renamed-locked");
    await page.locator("button.text-green-600").click();

    /* 409 inline error must appear mentioning observation scores */
    const errMsg = page.locator("p.text-red-600").first();
    await expect(errMsg).toBeVisible({ timeout: 8_000 });
    await expect(errMsg).toContainText(/observation score/i);
  });

  /* ── Test 3: slug rename succeeds when no scores reference it ─────────── */

  test("slug rename succeeds and new slug appears when no observation scores reference it", async ({ page }) => {
    const freeSlug    = `e2e-free-${RUN_ID}`;
    const renamedSlug = `e2e-renamed-${RUN_ID}`;

    /* Create a domain with no observation scores */
    const domResp = await page.request.post(
      `/api/rubric/categories/${catId}/domains`,
      { data: { name: "Rename-Safe Domain", slug: freeSlug, displayOrder: 0 } },
    );
    expect(domResp.ok(), `domain creation failed: ${await domResp.text()}`).toBeTruthy();

    /* Reload so the domain appears */
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByText(`E2E Slug Test ${RUN_ID}`, { exact: false }).first().click();
    await page.waitForLoadState("networkidle");

    /* Click the pencil button on the rename-safe domain */
    const slugCode = page.locator("code").filter({ hasText: freeSlug });
    await expect(slugCode).toBeVisible({ timeout: 10_000 });
    await slugCode
      .locator("xpath=ancestor::div[contains(@class,'items-start')]")
      .getByRole("button")
      .first()
      .click();

    /* Change the slug and save */
    await page.getByPlaceholder("slug").fill(renamedSlug);
    await page.locator("button.text-green-600").click();

    /* New slug must appear; old slug must be gone */
    await expect(page.locator("code").filter({ hasText: renamedSlug })).toBeVisible({ timeout: 8_000 });
    await expect(page.locator("code").filter({ hasText: freeSlug })).not.toBeVisible();
  });
});
