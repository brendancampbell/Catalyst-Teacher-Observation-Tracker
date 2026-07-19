import { test, expect } from "@playwright/test";

/**
 * Confirms that the ActionStepsCard and ActionStepsDrawer components in
 * src/components/TeacherScoreOverlay.tsx work correctly on a real teacher profile.
 *
 * Test data
 * ---------
 * Teacher : Grace Liu (DEMO-T-007), school 14 (Camden Prep Copewood MS)
 *           Has 2 open action steps + 1 mastered action step in the database.
 * Login   : Brendan Campbell (U10, NETWORK_ADMIN) via the dev-login endpoint.
 *           (Available only in non-production environments.)
 *
 * Navigation
 * ----------
 * The ActionStepsCard + ActionStepsDrawer pattern lives in
 * src/components/TeacherScoreOverlay.tsx, which renders as an overlay inside the
 * main dashboard.  A network admin defaults to the school-grid home, so the
 * test navigates to schoolId=14 (showing the teacher table), then clicks the
 * "Grace Liu" button to open her profile overlay — the same path a real user
 * takes.  Relying on the ?teacher= URL param to auto-open the overlay is
 * fragile: the auto-open useEffect fires only after teachers[] loads, creating
 * a timing window where the wait assertion completes on the table row text
 * rather than the profile card.
 *
 * Layout expectations
 * -------------------
 * The right rail of the TeacherScoreOverlay renders (top to bottom):
 *   1. ActionStepsCard  (lg:col-span-2)
 *   2. ✦ Teacher Strengths (Glows)
 *   3. ↑ Growth Areas (Grows)
 *
 * The left rail (lg:col-span-3) holds the domain score breakdown.  At the
 * Desktop Chrome viewport (1280 × 720) the right rail starts past the 50 %
 * midpoint of the viewport width; we use bounding-box coordinates to confirm
 * this and that the card is vertically above the Glows heading.
 */

const TEACHER_NAME = "Grace Liu";
const LOGIN_EMPLOYEE_ID = "U10";
const SCHOOL_PATH = "/?schoolId=14&schoolName=Camden+Prep+Copewood+MS";

test.describe("Action Steps drawer on Teacher Profile overlay", () => {
  test.beforeEach(async ({ page }) => {
    const resp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: LOGIN_EMPLOYEE_ID },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.ok).toBe(true);

    await page.goto(SCHOOL_PATH);

    await page.getByRole("button", { name: TEACHER_NAME }).click();

    const card = page.getByRole("button", { name: "Open Action Steps" });
    await expect(card).toBeVisible({ timeout: 15_000 });
  });

  test("card is in the right column and vertically above Glows/Grows; no legacy full-width block", async ({ page }) => {
    const card = page.getByRole("button", { name: "Open Action Steps" });
    await expect(card).toBeVisible();

    const cardBox = await card.boundingBox();
    expect(cardBox, "ActionStepsCard bounding box must be non-null").not.toBeNull();

    const viewportWidth = page.viewportSize()!.width;

    // The right column (lg:col-span-2 of a lg:grid-cols-5 grid) starts past
    // the 50 % mark of the viewport at the Desktop Chrome 1280 px width.
    expect(
      cardBox!.x,
      "ActionStepsCard left edge should be in the right half of the page",
    ).toBeGreaterThan(viewportWidth * 0.5);

    // The Glows heading renders below ActionStepsCard in the same right rail.
    const glowsHeading = page.getByRole("heading", {
      name: /Teacher Strengths \(Glows\)/,
    });
    if (await glowsHeading.isVisible()) {
      const glowsBox = await glowsHeading.boundingBox();
      expect(
        cardBox!.y + cardBox!.height,
        "ActionStepsCard bottom edge should be above the Glows heading",
      ).toBeLessThan(glowsBox!.y);
    }

    // Drawer sections must NOT be visible on the profile page itself
    // (they are only rendered inside the drawer/dialog).
    await expect(
      page.getByRole("heading", { name: "Open Action Steps" }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Mastered Action Steps" }),
    ).not.toBeVisible();
  });

  test("drawer opens when card is clicked and shows Open and Mastered sections", async ({ page }) => {
    await page.getByRole("button", { name: "Open Action Steps" }).click();

    const drawer = page.getByRole("dialog", { name: "Action Steps" });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    await expect(drawer.getByText("Action Steps").first()).toBeVisible();
    await expect(drawer.getByText("Open").first()).toBeVisible();
    await expect(drawer.getByText("Mastered").first()).toBeVisible();
  });

  test("drawer closes when the close button is clicked", async ({ page }) => {
    await page.getByRole("button", { name: "Open Action Steps" }).click();
    const drawer = page.getByRole("dialog", { name: "Action Steps" });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Close" }).click();
    await expect(drawer).not.toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByRole("button", { name: "Open Action Steps" }),
    ).toBeVisible();
  });

  test("drawer closes when the backdrop is clicked", async ({ page }) => {
    await page.getByRole("button", { name: "Open Action Steps" }).click();
    const drawer = page.getByRole("dialog", { name: "Action Steps" });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    await page.mouse.click(100, 400);

    await expect(drawer).not.toBeVisible({ timeout: 5_000 });
  });
});
