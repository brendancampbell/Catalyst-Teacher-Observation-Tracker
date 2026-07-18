import { test, expect } from "@playwright/test";

/**
 * Confirms that when POST /api/ai/analysis returns an error (422), the
 * handleInstantAnalysis catch block:
 *   1. Shows a user-readable error message in the chat thread.
 *   2. Clears the loading/typing state (chatTyping → false, streamingText → "").
 *   3. Resets isInstantAnalyzing to false (proven by clicking "New Chat" to return
 *      to the empty state and asserting the "Instant Analysis" button is enabled).
 *
 * UI flow note
 * -----------
 * The "Instant Analysis" button lives only in the empty state (activeChatId === null).
 * handleInstantAnalysis calls createChatSession first, then setActiveChatId(), then
 * generateAIAnalysis(). By the time the 422 lands, the UI has already switched to
 * the active-chat view. To assert `isInstantAnalyzing === false` on the button, the
 * test clicks "New Chat" (which calls handleNewChat → setActiveChatId(null)) to
 * return to the empty state where the button is rendered.
 *
 * Test strategy
 * -------------
 * 1.  Login as U10 (NETWORK_ADMIN).
 * 2.  Intercept fetch via addInitScript (runs before React):
 *       POST /api/ai/chats    → 200 fake session (needed so activeChatId is set and
 *                               the active-chat view renders — error messages live there)
 *       POST /api/ai/analysis → 422 with { error: "" }
 *                               Empty error → HttpError message is "" (falsy)
 *                               → catch block uses the hardcoded fallback text
 *       GET  /api/ai/chats    → [fakeSession] (sidebar stays stable)
 * 3.  Navigate to /action-center → open Data Assistant tab.
 * 4.  Click "Instant Analysis" — fires, POST /api/ai/analysis returns 422, catch runs.
 * 5.  Assert fallback error text "couldn't generate the analysis" is visible in chat.
 * 6.  Assert the "Stop generating" button is NOT visible (chatTyping reset to false).
 * 7.  Assert the chat send-message textarea is visible (confirms normal state restored).
 * 8.  Click "New Chat" in the sidebar → activeChatId resets to null → empty state.
 * 9.  Assert "Instant Analysis" button is visible AND enabled — explicit proof that
 *     isInstantAnalyzing was reset to false by the finally block.
 *
 * Fake session IDs used by this file: 99_995
 * Other specs use: 99_996 (persistence), 99_997 (fresh-state),
 *                  99_998 (copy-button), 99_999 (stop-button)
 */

const LOGIN_EMPLOYEE_ID  = "U10";
const FAKE_SESSION_ID    = 99_995;
const FAKE_SESSION_TITLE = "Jul 18, 2026 Instant Analysis Error Test";

/* Substring from the hardcoded fallback in the catch block of handleInstantAnalysis */
const EXPECTED_ERROR_SUBSTRING = "couldn't generate the analysis";

test.describe("Instant Analysis — error handling on API failure", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("shows fallback error message and re-enables button when analysis API returns 422", async ({ page }) => {
    /* ── 1. Login ─────────────────────────────────────────────────────── */
    const loginResp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: LOGIN_EMPLOYEE_ID },
    });
    expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();
    const loginBody = await loginResp.json();
    expect(loginBody.ok, "dev-login body.ok must be true").toBe(true);

    /* ── 2. Register fetch mock before page load ─────────────────────── */
    await page.addInitScript(
      ({
        fakeSessionId,
        fakeSessionTitle,
      }: {
        fakeSessionId: number;
        fakeSessionTitle: string;
      }) => {
        const now = new Date().toISOString();
        const fakeSession = {
          id:        fakeSessionId,
          title:     fakeSessionTitle,
          createdAt: now,
          updatedAt: now,
        };

        const orig = window.fetch.bind(window);
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : (input as Request).url;
          const method = (init?.method ?? "GET").toUpperCase();

          /* POST /api/ai/chats → create session (succeeds).
             handleInstantAnalysis calls this first; it sets activeChatId so
             the active-chat view renders and error messages become visible. */
          if (
            url.includes("/api/ai/chats") &&
            method === "POST" &&
            !url.includes("/messages") &&
            !url.includes("/stream")
          ) {
            return new Response(
              JSON.stringify(fakeSession),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          /* POST /api/ai/analysis → 422 with empty error body.
             apiFetch parses body.error as "" (falsy), so HttpError("422", "") is thrown.
             In the catch: err.message is "" (falsy) → hardcoded fallback text is used:
             "Sorry, I couldn't generate the analysis right now. Please try again." */
          if (url.includes("/api/ai/analysis") && method === "POST") {
            return new Response(
              JSON.stringify({ error: "" }),
              { status: 422, headers: { "Content-Type": "application/json" } },
            );
          }

          /* GET /api/ai/chats → session list (keeps sidebar stable) */
          if (
            url.includes("/api/ai/chats") &&
            method === "GET" &&
            !url.match(/\/api\/ai\/chats\/\d+/) &&
            !url.includes("/messages")
          ) {
            return new Response(
              JSON.stringify([fakeSession]),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          return orig(input, init);
        };
      },
      { fakeSessionId: FAKE_SESSION_ID, fakeSessionTitle: FAKE_SESSION_TITLE },
    );

    /* ── 3. Navigate to /action-center and open Data Assistant tab ───── */
    await page.goto("/action-center");
    await page.waitForLoadState("networkidle");

    const assistantTab = page.getByRole("tab", { name: /Data Assistant/i });
    await expect(assistantTab).toBeVisible({ timeout: 10_000 });
    await assistantTab.click();

    /* ── 4. Click "Instant Analysis" — fires, API returns 422, catch runs ─ */
    const instantAnalysisBtn = page.getByRole("button", { name: /Instant Analysis/i });
    await expect(instantAnalysisBtn).toBeVisible({ timeout: 8_000 });
    await instantAnalysisBtn.click();

    /* ── 5. Assert the fallback error message appears in the chat ─────── */
    /*
     * apiFetch receives 422 + body { error: "" }.
     * body.error is "" → "" ?? statusText evaluates to "" (nullish coalescing
     * does NOT trigger for ""). So HttpError(422, "") is thrown → err.message="".
     * catch block: err instanceof Error && err.message → false → shows fallback:
     *   "Sorry, I couldn't generate the analysis right now. Please try again."
     */
    await expect(
      page.getByText(EXPECTED_ERROR_SUBSTRING, { exact: false }),
      `Chat must display a message containing "${EXPECTED_ERROR_SUBSTRING}"`,
    ).toBeVisible({ timeout: 10_000 });

    /* ── 6 & 7. Confirm loading state cleared in active-chat view ─────── */
    /*
     * active-chat input bar (action-center.tsx ~line 2259):
     *   {chatTyping || !!streamingText
     *     ? <button>Stop generating</button>
     *     : <textarea/> + send button}
     *
     * After catch: setChatTyping(false) + setStreamingText("") → textarea visible.
     */
    await expect(
      page.getByRole("button", { name: /Stop generating/i }),
      '"Stop generating" must not be visible — chatTyping reset to false',
    ).not.toBeVisible({ timeout: 5_000 });

    await expect(
      page.locator("textarea"),
      "Chat textarea must be visible — confirms chatTyping cleared",
    ).toBeVisible({ timeout: 5_000 });

    /* ── 8. Navigate back to empty state via "New Chat" ──────────────── */
    /*
     * Clicking "New Chat" calls handleNewChat → setActiveChatId(null).
     * This returns the UI to the empty state where the "Instant Analysis" button lives.
     */
    const newChatBtn = page.getByRole("button", { name: /New Chat/i });
    await expect(newChatBtn).toBeVisible({ timeout: 5_000 });
    await newChatBtn.click();

    /* ── 9. Assert "Instant Analysis" button is visible AND enabled ───── */
    /*
     * The button is disabled when isInstantAnalyzing===true (action-center.tsx ~line 2013).
     * finally { setIsInstantAnalyzing(false) } always runs after the catch block.
     * If it had NOT run, the button would be disabled (or absent) here.
     */
    await expect(
      instantAnalysisBtn,
      '"Instant Analysis" button must be visible in empty state after error',
    ).toBeVisible({ timeout: 8_000 });

    await expect(
      instantAnalysisBtn,
      '"Instant Analysis" button must be enabled — isInstantAnalyzing reset to false',
    ).toBeEnabled();
  });
});
