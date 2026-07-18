import { test, expect } from "@playwright/test";

/**
 * Regression guard: bulk upload results panel renders all four status categories.
 *
 * Background
 * ----------
 * Task #485 split the results panel into four distinct categories:
 *   created  → "N new hires added" pill + "New hires added (N)" section
 *   assigned → "N returning person/people re-assigned" pill + "Returning staff re-assigned (N)" section
 *   skipped  → "N already up to date" pill + "Already up to date (N)" section
 *   error    → "N error/errors" pill + "Errors (N)" section
 *
 * This test intercepts POST /api/people/bulk with a stubbed response that
 * contains rows of all four status types, then asserts every pill and every
 * section header is visible. It is the CI signal that prevents a future
 * API-shape or JSX change from silently collapsing the breakdown.
 *
 * Test strategy
 * -------------
 * 1. Login as U10 (NETWORK_ADMIN) — required for bulk import access.
 * 2. Register a fetch mock that intercepts POST /api/people/bulk and returns
 *    a fixed mixed-status payload (2 created, 1 assigned, 3 skipped, 1 error).
 * 3. Navigate to /admin, click the "Users" tab, click the "Bulk Upload" sub-tab.
 * 4. Upload a minimal valid CSV (7 data rows) via the hidden file input.
 * 5. Click "Import 7 people".
 * 6. Assert all four summary pills are visible with the correct counts.
 * 7. Assert all four ResultSection headers are visible with the correct counts.
 *
 * No rows are written to the database — the API call is fully intercepted by the
 * fetch mock installed via addInitScript.
 */

const LOGIN_EMPLOYEE_ID = "U10";

/* Fixed fake response — 2 created, 1 assigned, 3 skipped, 1 error */
const FAKE_BULK_RESULTS = {
  results: [
    { row: 1, status: "created",  name: "Alice One",    email: "alice.one@test.com" },
    { row: 2, status: "created",  name: "Bob Two",      email: "bob.two@test.com" },
    { row: 3, status: "assigned", name: "Carol Three",  email: "carol.three@test.com" },
    { row: 4, status: "skipped",  name: "Dave Four",    email: "dave.four@test.com",   reason: "No change needed" },
    { row: 5, status: "skipped",  name: "Eve Five",     email: "eve.five@test.com",    reason: "No change needed" },
    { row: 6, status: "skipped",  name: "Frank Six",    email: "frank.six@test.com",   reason: "No change needed" },
    { row: 7, status: "error",    name: "Grace Seven",  email: "grace.seven@test.com", reason: "School not found" },
  ],
};

/* Minimal CSV — 7 data rows so the preview shows "7 people ready to import".
   Content doesn't matter; the API response is mocked. */
const CSV_CONTENT = [
  "firstName,lastName,email,employeeId,role,school",
  "Alice,One,alice.one@test.com,E001,COACH,Lincoln Park ES",
  "Bob,Two,bob.two@test.com,E002,COACH,Lincoln Park ES",
  "Carol,Three,carol.three@test.com,E003,COACH,Lincoln Park ES",
  "Dave,Four,dave.four@test.com,E004,COACH,Lincoln Park ES",
  "Eve,Five,eve.five@test.com,E005,COACH,Lincoln Park ES",
  "Frank,Six,frank.six@test.com,E006,COACH,Lincoln Park ES",
  "Grace,Seven,grace.seven@test.com,E007,COACH,Fake School",
].join("\n");

test.describe("Bulk upload — results breakdown shows all four status categories", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test(
    "created / assigned / skipped / error pills and section headers all render correctly",
    async ({ page }) => {
      /* ── 1. Login ─────────────────────────────────────────────────────── */
      const loginResp = await page.request.post("/api/auth/dev-login", {
        data: { employeeId: LOGIN_EMPLOYEE_ID },
      });
      expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();

      /* ── 2. Stub POST /api/people/bulk before any page load ───────────── */
      await page.addInitScript(
        (fakeResults: typeof FAKE_BULK_RESULTS) => {
          const orig = window.fetch.bind(window);
          window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url =
              typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : (input as Request).url;
            const method = (init?.method ?? "GET").toUpperCase();

            if (url.includes("/api/people/bulk") && method === "POST") {
              return new Response(JSON.stringify(fakeResults), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }

            return orig(input, init);
          };
        },
        FAKE_BULK_RESULTS,
      );

      /* ── 3. Navigate to /admin ────────────────────────────────────────── */
      await page.goto("/admin");
      await page.waitForLoadState("networkidle");

      /* ── 4. Click the "Users" admin tab ──────────────────────────────── */
      const usersTab = page.getByRole("button", { name: "Users" });
      await expect(usersTab, "Users tab must be visible").toBeVisible({ timeout: 10_000 });
      await usersTab.click();

      /* ── 5. Click the "Bulk Upload" sub-tab ──────────────────────────── */
      const bulkUploadTab = page.getByRole("button", { name: "Bulk Upload" });
      await expect(bulkUploadTab, "Bulk Upload sub-tab must be visible").toBeVisible({ timeout: 8_000 });
      await bulkUploadTab.click();

      /* ── 6. Upload the CSV via the hidden file input ──────────────────── */
      await page.locator('input[type="file"][accept=".csv"]').setInputFiles({
        name:     "staff.csv",
        mimeType: "text/csv",
        buffer:   Buffer.from(CSV_CONTENT, "utf-8"),
      });

      /* ── 7. Wait for the preview and click Import ─────────────────────── */
      const importBtn = page.getByRole("button", { name: /Import 7 people/i });
      await expect(importBtn, "Import button must appear after CSV is parsed").toBeVisible({ timeout: 8_000 });
      await importBtn.click();

      /* ── 8. Assert all four summary pills ────────────────────────────── */
      await expect(
        page.getByText("2 new hires added"),
        "Green pill: 2 created rows",
      ).toBeVisible({ timeout: 10_000 });

      await expect(
        page.getByText("1 returning person re-assigned"),
        "Blue pill: 1 assigned row",
      ).toBeVisible({ timeout: 5_000 });

      await expect(
        page.getByText("3 already up to date"),
        "Yellow pill: 3 skipped rows",
      ).toBeVisible({ timeout: 5_000 });

      await expect(
        page.getByText("1 error"),
        "Red pill: 1 error row",
      ).toBeVisible({ timeout: 5_000 });

      /* ── 9. Assert all four ResultSection headers ─────────────────────── */
      await expect(
        page.getByText("New hires added (2)"),
        "Created section header",
      ).toBeVisible({ timeout: 5_000 });

      await expect(
        page.getByText("Returning staff re-assigned (1)"),
        "Assigned section header",
      ).toBeVisible({ timeout: 5_000 });

      await expect(
        page.getByText("Already up to date (3)"),
        "Skipped section header",
      ).toBeVisible({ timeout: 5_000 });

      await expect(
        page.getByText("Errors (1)"),
        "Error section header",
      ).toBeVisible({ timeout: 5_000 });
    },
  );
});
