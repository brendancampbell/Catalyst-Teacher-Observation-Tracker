import { test, expect } from "@playwright/test";

/**
 * Confirms that clicking "+ Observation" on the Drafts page for a brand-new
 * coach (zero prior observations → fetchMyLatestRubricSlug returns null) falls
 * back to the Q1 rubric and opens the NewObservationModal successfully.
 *
 * Test strategy
 * -------------
 * 1. Log in as EMP-CO-002 (Sandra Ortiz, COACH) — a user whose
 *    observerEmployeeId has no published observations in the DB.
 * 2. Route-intercept /api/observations/my-latest-rubric to return
 *    { slug: null }, making the null-fallback path deterministic even if the
 *    DB ever accumulates data for this user.
 * 3. Spy on /api/dashboard requests to confirm the slug passed is "Q1".
 * 4. Navigate to /drafts and click the "+ Observation" pill.
 * 5. Assert the modal dialog opens without an error toast.
 */

// A COACH who has zero published observations in the DB — confirmed by:
// SELECT employee_id FROM people WHERE role='COACH' AND employee_id NOT IN
//   (SELECT observer_employee_id FROM observations WHERE status!='draft')
const COACH_EMPLOYEE_ID = "10195";

test.describe("+ Observation Q1 fallback for brand-new users", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("modal opens with Q1 rubric when user has no prior observations", async ({ page }) => {
    /* ── 1. Login ─────────────────────────────────────────────────── */
    const loginResp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: COACH_EMPLOYEE_ID },
    });
    expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();
    const loginBody = await loginResp.json();
    expect(loginBody.ok, "dev-login body.ok must be true").toBe(true);

    /* ── 2. Intercept my-latest-rubric → null (brand-new user) ───── */
    await page.route("**/api/observations/my-latest-rubric", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ slug: null }),
      });
    });

    /* ── 3. Spy on dashboard requests and capture the rubricSet param */
    const capturedRubricSlugs: string[] = [];
    await page.route("**/api/dashboard**", async (route) => {
      const url = new URL(route.request().url());
      const slug = url.searchParams.get("rubricSet");
      if (slug) capturedRubricSlugs.push(slug);
      await route.continue();
    });

    /* ── 4. Navigate to /drafts ───────────────────────────────────── */
    await page.goto("/drafts");
    await page.waitForLoadState("networkidle");

    /* ── 5. Click the "+ Observation" pill in the header ─────────── */
    const addObsBtn = page.locator('[data-testid="header-add-obs-pill"]');
    await expect(addObsBtn).toBeVisible({ timeout: 10_000 });
    await addObsBtn.click();

    /* ── 6. Modal must open (no error toast) ─────────────────────── */
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    /* Confirm no destructive toast was shown */
    const errorToast = page.locator('[data-variant="destructive"], .toast-destructive, [role="alert"]');
    // Give any toast a moment to appear if it was going to
    await page.waitForTimeout(500);
    const toastCount = await errorToast.count();
    expect(toastCount, "no error toast should appear").toBe(0);

    /* ── 7. Confirm the dashboard was fetched with rubricSet=Q1 ───── */
    expect(
      capturedRubricSlugs.some((s) => s === "Q1"),
      `dashboard must be fetched with rubricSet=Q1, got: ${JSON.stringify(capturedRubricSlugs)}`,
    ).toBe(true);
  });
});
