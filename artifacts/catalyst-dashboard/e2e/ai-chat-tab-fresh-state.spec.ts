import { test, expect } from "@playwright/test";

/**
 * Confirms that the Data Assistant tab always opens in a blank new-chat state
 * when the page loads — it must NOT auto-restore the previously selected chat
 * session from localStorage.
 *
 * Background
 * ----------
 * A useEffect that read `readPersistedChatId()` from localStorage and called
 * `selectSession()` was removed in Task #407.  This spec is the regression
 * guard: it proves that even when localStorage holds a stored session ID AND
 * the sessions list contains a matching session, the tab still opens blank.
 *
 * Test strategy
 * -------------
 * 1. Login as U10 (NETWORK_ADMIN — required to see the Data Assistant tab).
 * 2. Fetch /api/auth/me to obtain the internal user `id` used in the
 *    localStorage storage key (`catalyst_active_chat_${userId}`).
 * 3. Register an addInitScript that:
 *      a. Seeds localStorage with the storage key → FAKE_SESSION_ID
 *         (simulates a returning user whose last chat was session 99_997).
 *      b. Intercepts GET /api/ai/chats to return a session list that
 *         includes FAKE_SESSION_ID — so the old auto-restore logic *would*
 *         have matched and called selectSession().
 * 4. Navigate to /action-center, click the Data Assistant tab.
 * 5. Assert blank new-chat state: the initial textarea placeholder is
 *    visible ("Ask about your school's observation data…"), and the
 *    follow-up placeholder ("Ask a follow-up question…") is absent.
 * 6. Navigate away to "/" (full page unload, component unmounts) and back
 *    to /action-center.  addInitScript re-runs, re-seeding localStorage.
 * 7. Assert blank state again — proves the behaviour persists across
 *    navigations, not just on the very first mount.
 *
 * Fake session IDs used by this file: 99_997
 * Other specs use:  99_998 (copy-button), 99_999 (stop-button)
 */

const LOGIN_EMPLOYEE_ID = "U10";
const FAKE_SESSION_ID   = 99_997;

const NEW_CHAT_PLACEHOLDER  = "Ask about your school's observation data…";
const FOLLOWUP_PLACEHOLDER  = "Ask a follow-up question…";

test.describe("Action Center — Data Assistant fresh-state on tab entry", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test(
    "Data Assistant tab opens blank even when localStorage holds a stored session, and stays blank after navigating away and back",
    async ({ page }) => {
      /* ── 1. Login ──────────────────────────────────────────────────────── */
      const loginResp = await page.request.post("/api/auth/dev-login", {
        data: { employeeId: LOGIN_EMPLOYEE_ID },
      });
      expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();
      const loginBody = await loginResp.json();
      expect(loginBody.ok, "dev-login body.ok must be true").toBe(true);

      /* ── 2. Obtain internal user id (used as part of localStorage key) ── */
      const meResp = await page.request.get("/api/auth/me");
      expect(meResp.ok(), "auth/me must succeed").toBeTruthy();
      const me = await meResp.json() as { id: number | string };

      /* ── 3. Register init script ─────────────────────────────────────────
         Runs in the browser context before React scripts on every page load.
         Seeds localStorage so that readPersistedChatId() (if it were still
         present) would return FAKE_SESSION_ID, and mocks the sessions API
         to confirm the session exists in the list. */
      await page.addInitScript(
        ({
          storageKey,
          fakeSessionId,
          fakeSessionTitle,
        }: {
          storageKey: string;
          fakeSessionId: number;
          fakeSessionTitle: string;
        }) => {
          /* Seed the storage key as a returning user would have */
          try {
            localStorage.setItem(storageKey, String(fakeSessionId));
          } catch { /* storage may be blocked */ }

          /* Mock GET /api/ai/chats → include the fake session so
             sessions.find((s) => s.id === persisted) would have matched */
          const orig = window.fetch.bind(window);
          window.fetch = async (
            input: RequestInfo | URL,
            init?: RequestInit,
          ) => {
            const url =
              typeof input === "string"
                ? input
                : input instanceof URL
                ? input.href
                : (input as Request).url;

            const isSessionList =
              url.includes("/api/ai/chats") &&
              !url.includes("/messages") &&
              !url.includes("/stream") &&
              (init?.method ?? "GET").toUpperCase() === "GET";

            if (isSessionList) {
              const now = new Date().toISOString();
              return new Response(
                JSON.stringify([
                  {
                    id: fakeSessionId,
                    title: fakeSessionTitle,
                    createdAt: now,
                    updatedAt: now,
                  },
                ]),
                { status: 200, headers: { "Content-Type": "application/json" } },
              );
            }

            return orig(input, init);
          };
        },
        {
          storageKey:       `catalyst_active_chat_${me.id}`,
          fakeSessionId:    FAKE_SESSION_ID,
          fakeSessionTitle: "Stored Chat Session — should not auto-load",
        },
      );

      /* ── 4. Visit 1: fresh page load ────────────────────────────────────── */
      await page.goto("/action-center");
      await page.waitForLoadState("networkidle");

      const assistantTab = page.getByRole("tab", { name: /Data Assistant/i });
      await expect(assistantTab).toBeVisible({ timeout: 10_000 });
      await assistantTab.click();

      /* Core assertion A: blank new-chat state — initial placeholder visible */
      const newChatTextarea = page.locator(`textarea[placeholder="${NEW_CHAT_PLACEHOLDER}"]`);
      await expect(
        newChatTextarea,
        "Visit 1: initial textarea placeholder must be visible (blank new-chat state)",
      ).toBeVisible({ timeout: 8_000 });

      /* Core assertion B: follow-up placeholder must NOT be present
         (that only appears when a chat session is actively selected) */
      await expect(
        page.locator(`textarea[placeholder="${FOLLOWUP_PLACEHOLDER}"]`),
        "Visit 1: follow-up textarea must be absent (no chat auto-selected)",
      ).not.toBeVisible();

      /* ── 5. Navigate away to trigger full component unmount ──────────── */
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      /* ── 6. Visit 2: navigate back — addInitScript re-runs, re-seeding
              localStorage so the stored session is still present ──────── */
      await page.goto("/action-center");
      await page.waitForLoadState("networkidle");

      const assistantTab2 = page.getByRole("tab", { name: /Data Assistant/i });
      await expect(assistantTab2).toBeVisible({ timeout: 10_000 });
      await assistantTab2.click();

      /* Core assertion C: still blank after return visit */
      const newChatTextarea2 = page.locator(`textarea[placeholder="${NEW_CHAT_PLACEHOLDER}"]`);
      await expect(
        newChatTextarea2,
        "Visit 2: initial textarea placeholder must be visible after return (no auto-restore)",
      ).toBeVisible({ timeout: 8_000 });

      await expect(
        page.locator(`textarea[placeholder="${FOLLOWUP_PLACEHOLDER}"]`),
        "Visit 2: follow-up textarea must still be absent after return",
      ).not.toBeVisible();
    },
  );
});
