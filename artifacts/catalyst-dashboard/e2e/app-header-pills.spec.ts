import { test, expect } from "@playwright/test";

/**
 * Confirms that the AppHeader action-area pills are visually consistent at
 * desktop width after height and grouping changes.
 *
 * Pills under test (all rendered in the right section of the header)
 * ------------------------------------------------------------------
 *   1. Rubric dropdown pill   — [data-testid="header-rubric-pill"]
 *   2. + Observation pill     — [data-testid="header-add-obs-pill"]
 *   3. Icon-pair pill         — [data-testid="header-icon-pill"]
 *   4. User menu pill         — [data-testid="header-user-pill"]
 *
 * Alignment contract
 * ------------------
 * All visible pills must have a rendered height within HEIGHT_TOLERANCE pixels
 * of each other.  A divergence beyond that threshold indicates a regression in
 * padding, line-height, or flex-alignment.
 *
 * Test data
 * ---------
 * Login: Brendan Campbell (U10, NETWORK_ADMIN) — has rubric sets, drafts,
 * action-center, and the + Observation button, so every pill is rendered.
 */

const LOGIN_EMPLOYEE_ID = "U10";
const HEIGHT_TOLERANCE  = 4; // px

test.describe("AppHeader pill alignment at desktop width", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    const resp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: LOGIN_EMPLOYEE_ID },
    });
    expect(resp.ok(), "dev-login must succeed").toBeTruthy();
    const body = await resp.json();
    expect(body.ok, "dev-login body.ok must be true").toBe(true);

    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("all header pills are the same height (within tolerance)", async ({ page }) => {
    const pillSelectors: { name: string; testid: string }[] = [
      { name: "Rubric dropdown", testid: "header-rubric-pill"  },
      { name: "+ Observation",   testid: "header-add-obs-pill" },
      { name: "Icon pair",       testid: "header-icon-pill"    },
      { name: "User menu",       testid: "header-user-pill"    },
    ];

    const visiblePills: { name: string; height: number }[] = [];

    for (const { name, testid } of pillSelectors) {
      const el = page.locator(`[data-testid="${testid}"]`);
      if (await el.isVisible()) {
        const box = await el.boundingBox();
        expect(box, `${name} bounding box must be non-null`).not.toBeNull();
        visiblePills.push({ name, height: box!.height });
      }
    }

    expect(
      visiblePills.length,
      "At least two pills must be visible to compare heights",
    ).toBeGreaterThanOrEqual(2);

    const heights = visiblePills.map((p) => p.height);
    const minH    = Math.min(...heights);
    const maxH    = Math.max(...heights);
    const spread  = maxH - minH;

    // Build a helpful message showing each pill's measured height
    const detail = visiblePills
      .map((p) => `  ${p.name}: ${p.height.toFixed(1)} px`)
      .join("\n");

    expect(
      spread,
      `Pill heights must not diverge by more than ${HEIGHT_TOLERANCE} px.\n` +
      `Measured heights (spread = ${spread.toFixed(1)} px):\n${detail}`,
    ).toBeLessThanOrEqual(HEIGHT_TOLERANCE);
  });

  test("AppHeader screenshot at desktop width", async ({ page }) => {
    const header = page.locator("header").first();
    await expect(header).toBeVisible({ timeout: 10_000 });

    // Capture a screenshot of just the header element for visual reference
    await expect(header).toHaveScreenshot("app-header-desktop.png", {
      maxDiffPixelRatio: 0.03,
    });
  });
});
