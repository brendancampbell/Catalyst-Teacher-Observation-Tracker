import { test, expect } from "@playwright/test";

/**
 * E2E tests — Support page role-based rendering and user-dropdown link.
 *
 * What is covered
 * ───────────────
 * For each testable role (COACH, SCHOOL_LEADER, NETWORK_LEADER, NETWORK_ADMIN):
 *   1. The "Support" link is present in the UserMenuDropdown.
 *   2. Clicking the link navigates to /support.
 *   3. The page <h1> matches the role-specific title.
 *   4. At least one role-specific placeholder block heading is rendered.
 *
 * Test accounts (dev-only, never Google auth)
 * ───────────────────────────────────────────
 *   COACH          — 00MCB1XTQ  Ziyadah Williams
 *   SCHOOL_LEADER  — 012508     Kelly Gardner
 *   NETWORK_LEADER — 012999     Estrella De La Torre
 *   NETWORK_ADMIN  — U10        Brendan Campbell
 *
 * Selector notes
 * ──────────────
 * - User-pill trigger: data-testid="header-user-pill"
 * - Support link text: "Support" (inside the dropdown <a>)
 * - Page heading: the single <h1> on /support
 * - Placeholder blocks: <h2> elements inside the main content area
 */

interface RoleCase {
  label:         string;
  employeeId:    string;
  expectedTitle: string;
  expectedBlock: string;
}

const ROLE_CASES: RoleCase[] = [
  {
    label:         "COACH",
    employeeId:    "00MCB1XTQ",
    expectedTitle: "Coach Support",
    expectedBlock: "Submitting an Observation",
  },
  {
    label:         "SCHOOL_LEADER",
    employeeId:    "012508",
    expectedTitle: "School Leader Support",
    expectedBlock: "Reading the Dashboard",
  },
  {
    label:         "NETWORK_LEADER",
    employeeId:    "012999",
    expectedTitle: "Network Leader Support",
    expectedBlock: "Network Dashboard",
  },
  {
    label:         "NETWORK_ADMIN",
    employeeId:    "U10",
    expectedTitle: "Network Admin Support",
    expectedBlock: "Network Dashboard",
  },
];

test.describe("Support page — role-based rendering and dropdown link", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const { label, employeeId, expectedTitle, expectedBlock } of ROLE_CASES) {
    test(`${label}: Support link in dropdown navigates to /support with correct content`, async ({ page }) => {
      /* ── 1. Dev login ───────────────────────────────────────────────── */
      const loginResp = await page.request.post("/api/auth/dev-login", {
        data: { employeeId },
      });
      expect(loginResp.ok(), `dev-login must succeed for ${label}`).toBeTruthy();
      const loginBody = await loginResp.json();
      expect(loginBody.ok, `dev-login body.ok must be true for ${label}`).toBe(true);

      /* ── 2. Navigate to dashboard root ─────────────────────────────── */
      await page.goto("/");
      await page.waitForSelector('[data-testid="header-user-pill"]', { timeout: 15_000 });

      /* ── 3. Open the user dropdown ──────────────────────────────────── */
      await page.click('[data-testid="header-user-pill"]');

      /* ── 4. Support link is visible in the dropdown ─────────────────── */
      const supportLink = page.getByRole("link", { name: "Support" });
      await expect(supportLink).toBeVisible({ timeout: 5_000 });

      /* ── 5. Click Support → navigates to /support ───────────────────── */
      await supportLink.click();
      await page.waitForURL(/\/support/, { timeout: 10_000 });

      /* ── 6. Page heading matches role ───────────────────────────────── */
      const heading = page.locator("h1");
      await expect(heading).toBeVisible({ timeout: 10_000 });
      // Heading rendered with CSS text-transform:uppercase; check case-insensitively
      const headingText = await heading.textContent();
      expect(headingText?.toLowerCase()).toBe(expectedTitle.toLowerCase());

      /* ── 7. Role-specific placeholder block is rendered ─────────────── */
      const block = page.locator("h2", { hasText: expectedBlock });
      await expect(block).toBeVisible({ timeout: 5_000 });
    });
  }
});
