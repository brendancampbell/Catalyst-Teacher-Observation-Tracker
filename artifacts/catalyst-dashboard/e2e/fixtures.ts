/**
 * Shared Playwright test fixture for the dashboard E2E suite.
 *
 * Stubs GET /api/notifications/active to return [] so the platform
 * notification modal never appears during tests and can't block clicks
 * on elements beneath it (z-index 9999 overlay).
 *
 * Import { test, expect } from "./fixtures" instead of "@playwright/test"
 * in every spec file — the custom `test` is a drop-in replacement.
 */
import { test as base, expect } from "@playwright/test";

export { expect } from "@playwright/test";
export type { Page, Locator, BrowserContext } from "@playwright/test";

export const test = base.extend<Record<string, never>>({
  page: async ({ page }, use) => {
    // Return an empty notification list so the modal never mounts.
    await page.route("**/api/notifications/active", (route) =>
      route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        "[]",
      }),
    );
    await use(page);
  },
});
