import { test, expect } from "@playwright/test";

/**
 * Confirms that mastering an action step on the Teacher Profile page visually
 * removes it from the Action Center's "Overdue Action Steps" tab without
 * requiring a hard page reload.
 *
 * Mechanism under test
 * --------------------
 * handleMaster() in TeacherProfile.tsx calls
 *   queryClient.invalidateQueries({ queryKey: QUERY_KEYS.overdueActionSteps })
 * after a successful PATCH /api/action-steps/:id/master.  This invalidation
 * forces the Action Center's overdueActionSteps query to refetch when the user
 * navigates back — no page reload needed.
 *
 * Test data
 * ---------
 * Teacher : Grace Liu (DEMO-T-007), school 14 (Camden Prep Copewood MS)
 *           Her real open steps all have future due dates, so the only
 *           overdue step in the table is the one seeded by beforeAll.
 * Login   : Brendan Campbell (U10, NETWORK_ADMIN) via POST /api/auth/dev-login.
 * Seed    : POST /api/dev/overdue-action-step (dev-only route, not in production)
 *           creates an action step with a past due date.
 * Cleanup : DELETE /api/dev/overdue-action-step/:id removes the seeded row.
 *
 * Flow
 * ----
 * 1.  beforeAll   — seed one overdue step for Grace Liu.
 * 2.  Login in the browser session.
 * 3.  Open Action Center → Intervention tab → Overdue Action Steps sub-tab.
 * 4.  Assert the seeded step's text is visible in the table.
 * 5.  Click Grace Liu's row → SPA-navigate to /teacher/DEMO-T-007.
 * 6.  Click "Mark Mastered" on the step card.
 * 7.  SPA-navigate back to Action Center via the AppHeader back link.
 * 8.  Re-open Intervention tab → Overdue Action Steps sub-tab.
 * 9.  Assert the seeded step's text is gone — no page reload was needed.
 * 10. afterAll    — delete the seeded row (cleanup even if mastering failed).
 */

const LOGIN_EMPLOYEE_ID   = "U10";
const TEACHER_EMPLOYEE_ID = "DEMO-T-007";
const PAST_DUE_DATE       = "2025-01-15";
const STEP_TEXT =
  "E2E-OVERDUE-CLEAR: Call on 3 students by name before posing CFU questions";

test.describe("Action Center — Overdue Action Steps clears after mastering (no reload)", () => {
  let seededStepId: number;

  /* ── Seed one overdue step before the test runs ─────────────────── */
  test.beforeAll(async ({ request }) => {
    const resp = await request.post("/api/dev/overdue-action-step", {
      data: {
        teacherEmployeeId:    TEACHER_EMPLOYEE_ID,
        assignedByEmployeeId: LOGIN_EMPLOYEE_ID,
        text:                 STEP_TEXT,
        dueDate:              PAST_DUE_DATE,
      },
    });
    expect(resp.ok(), `seed endpoint failed (${resp.status()}): ${await resp.text()}`).toBeTruthy();
    const body = await resp.json() as { ok: boolean; id: number };
    expect(body.ok).toBe(true);
    seededStepId = body.id;
  });

  /* ── Delete the seeded step regardless of test outcome ───────────── */
  test.afterAll(async ({ request }) => {
    if (seededStepId != null) {
      await request.delete(`/api/dev/overdue-action-step/${seededStepId}`);
    }
  });

  test(
    "mastering a step on the Teacher Profile removes it from the Overdue tab without a page reload",
    async ({ page }) => {
      /* ── 1. Authenticate in the browser session ─────────────────── */
      const loginResp = await page.request.post("/api/auth/dev-login", {
        data: { employeeId: LOGIN_EMPLOYEE_ID },
      });
      expect(loginResp.ok()).toBeTruthy();
      const loginBody = await loginResp.json() as { ok: boolean };
      expect(loginBody.ok).toBe(true);

      /* ── 2. Open the Action Center ──────────────────────────────── */
      await page.goto("/action-center");

      /* ── 3. Click the "Intervention" top-level tab ──────────────── */
      const interventionTab = page.getByRole("tab", { name: "Intervention" });
      await expect(interventionTab).toBeVisible({ timeout: 15_000 });
      await interventionTab.click();

      /* ── 4. Click the "Overdue Action Steps" sub-tab ────────────── */
      const overdueSubTab = page.getByRole("button", { name: /Overdue Action Steps/ });
      await expect(overdueSubTab).toBeVisible({ timeout: 10_000 });
      await overdueSubTab.click();

      /* ── 5. Confirm the seeded step appears in the table ─────────── */
      await expect(page.getByText(STEP_TEXT)).toBeVisible({ timeout: 10_000 });

      /* ── 6. Click Grace Liu's row → SPA-navigate to Teacher Profile ─
              The <tr> click navigates to /teacher/DEMO-T-007 via wouter. */
      await page.getByRole("cell", { name: "Grace Liu" }).first().click();
      await page.waitForURL(/\/teacher\/DEMO-T-007/, { timeout: 10_000 });

      /* ── 7. Find the seeded step card and click "Mark Mastered" ───── */
      const stepCard = page
        .locator(".space-y-2", { has: page.getByText(STEP_TEXT) })
        .first();
      const markMasteredBtn = stepCard.getByRole("button", { name: "Mark Mastered" });
      await expect(markMasteredBtn).toBeVisible({ timeout: 10_000 });

      await markMasteredBtn.click();

      /* Wait until the button disappears — the card collapses once the
         step transitions to "mastered" and is filtered out of openSteps. */
      await expect(
        stepCard.getByRole("button", { name: /Mark Mastered|Marking/ }),
      ).not.toBeVisible({ timeout: 10_000 });

      /* ── 8. SPA-navigate back to Action Center via the header link ───
              This is a wouter <Link> — no hard browser reload.
              The React Query cache (including the now-invalidated
              overdueActionSteps key) is fully preserved.              */
      /* Two "Action Center" links exist on this page: the AppHeader back-arrow
         link and the header pill. We want the back-arrow link, which is first
         in DOM order.                                                        */
      const backLink = page.getByRole("link", { name: "Action Center" }).first();
      await expect(backLink).toBeVisible({ timeout: 5_000 });
      await backLink.click();
      await page.waitForURL(/\/action-center/, { timeout: 10_000 });

      /* ── 9. Re-open the Intervention tab and the Overdue sub-tab ─── */
      const interventionTabAgain = page.getByRole("tab", { name: "Intervention" });
      await expect(interventionTabAgain).toBeVisible({ timeout: 10_000 });
      await interventionTabAgain.click();

      const overdueSubTabAgain = page.getByRole("button", { name: /Overdue Action Steps/ });
      await expect(overdueSubTabAgain).toBeVisible({ timeout: 10_000 });
      await overdueSubTabAgain.click();

      /* ── 10. Assert the seeded step is gone — no page reload occurred ─
               React Query re-fetched the overdue list because
               invalidateQueries was called in handleMaster.           */
      await expect(page.getByText(STEP_TEXT)).not.toBeVisible({ timeout: 10_000 });
    },
  );
});
