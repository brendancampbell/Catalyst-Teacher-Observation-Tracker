import { test, expect } from "@playwright/test";

/**
 * Confirms that the Instant Analysis card survives navigation and page reload
 * without relying on localStorage.
 *
 * Background
 * ----------
 * Before Task #408, Instant Analysis results were stored in localStorage.
 * Task #408 moved persistence to the database: the POST /api/ai/analysis
 * endpoint inserts the structured result as a chat message (with the
 * `instantAnalysis` JSON column populated), and the client reconstructs
 * the card via mapServerMessages() when the session is selected.
 *
 * This spec is the regression guard: it proves that after clearing all
 * localStorage and navigating away, the card is fully re-rendered from
 * the server-side message data when the user returns and selects the session.
 *
 * Test strategy
 * -------------
 * 1. Login as U10 (NETWORK_ADMIN — required to see the Data Assistant tab).
 * 2. Register a fetch mock (addInitScript, runs before React) that intercepts:
 *      POST /api/ai/chats              → returns FAKE_SESSION immediately
 *      POST /api/ai/analysis           → returns FAKE_STRUCTURED (no Claude call)
 *      GET  /api/ai/chats              → returns [FAKE_SESSION] as the session list
 *      GET  /api/ai/chats/:id/messages → returns FAKE_MESSAGE containing the
 *                                        instantAnalysis field (same structured data)
 * 3. Navigate to /action-center, click the Data Assistant tab.
 * 4. Click "Instant Analysis" — the card renders immediately from the POST
 *    response without any DB round-trip visible to the test.
 * 5. Assert the Instant Analysis card is visible (badge text "Instant analysis").
 * 6. Clear ALL localStorage (simulates localStorage becoming unavailable, or a
 *    different browser profile, or a cleared session).
 * 7. Navigate away to "/" then back to /action-center.
 * 8. Open the Data Assistant tab → session list shows our fake session.
 * 9. Click the session → messages are fetched from the mock GET endpoint.
 * 10. mapServerMessages() sees instantAnalysis on the message and re-renders
 *     the InstantAnalysisCard — assert the badge is still present.
 *
 * Fake session IDs used by this file: 99_996
 * Other specs use: 99_997 (fresh-state), 99_998 (copy-button), 99_999 (stop-button)
 */

const LOGIN_EMPLOYEE_ID = "U10";
const FAKE_SESSION_ID   = 99_996;
const FAKE_SESSION_TITLE = "Jul 18, 2026 Instant Analysis";

const FAKE_STRUCTURED = {
  contextLine:            "Q1 data · 12 teachers · 48 observations",
  summary:                "**Overall:** The school is performing at a solid level with strengths in classroom management.",
  findings: [
    {
      type:   "leverage",
      lead:   "Classroom Management",
      detail: "9 of 12 teachers scored above proficiency threshold.",
    },
    {
      type:   "flag",
      lead:   "Questioning Techniques",
      detail: "4 teachers scored below 0.5 — a priority growth area.",
    },
  ],
  chips:                  ["Which teachers need support?", "What are the top strengths?", "Summarize growth areas"],
  narrativeForContext:    "Q1 narrative context for follow-up questions.",
  overdueActionStepCount: 2,
};

const FAKE_MESSAGE = {
  id:              1,
  sessionId:       FAKE_SESSION_ID,
  role:            "assistant" as const,
  content:         FAKE_STRUCTURED.narrativeForContext,
  rubricSetSlug:   "Q1",
  instantAnalysis: FAKE_STRUCTURED,
  createdAt:       new Date().toISOString(),
};

test.describe("Instant Analysis — persistence survives navigation without localStorage", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test(
    "Instant Analysis card re-renders from server data after localStorage is cleared and user navigates back",
    async ({ page }) => {
      /* ── 1. Login ─────────────────────────────────────────────────────── */
      const loginResp = await page.request.post("/api/auth/dev-login", {
        data: { employeeId: LOGIN_EMPLOYEE_ID },
      });
      expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();
      const loginBody = await loginResp.json();
      expect(loginBody.ok, "dev-login body.ok must be true").toBe(true);

      /* ── 2. Register fetch mock before any page load ─────────────────── */
      await page.addInitScript(
        ({
          fakeSessionId,
          fakeSessionTitle,
          fakeStructured,
          fakeMessage,
        }: {
          fakeSessionId: number;
          fakeSessionTitle: string;
          fakeStructured: typeof FAKE_STRUCTURED;
          fakeMessage: typeof FAKE_MESSAGE;
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

            /* POST /api/ai/chats → create a chat session */
            if (url.includes("/api/ai/chats") && method === "POST" && !url.includes("/messages") && !url.includes("/stream")) {
              return new Response(
                JSON.stringify(fakeSession),
                { status: 200, headers: { "Content-Type": "application/json" } },
              );
            }

            /* POST /api/ai/analysis → return fake structured (no Claude call) */
            if (url.includes("/api/ai/analysis") && method === "POST") {
              return new Response(
                JSON.stringify({ structured: fakeStructured, rubricSetSlug: "Q1" }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              );
            }

            /* GET /api/ai/chats → session list */
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

            /* GET /api/ai/chats/:id/messages → return message with instantAnalysis */
            if (
              url.match(/\/api\/ai\/chats\/\d+\/messages/) &&
              method === "GET"
            ) {
              return new Response(
                JSON.stringify([fakeMessage]),
                { status: 200, headers: { "Content-Type": "application/json" } },
              );
            }

            return orig(input, init);
          };
        },
        {
          fakeSessionId:   FAKE_SESSION_ID,
          fakeSessionTitle: FAKE_SESSION_TITLE,
          fakeStructured:  FAKE_STRUCTURED,
          fakeMessage:     FAKE_MESSAGE,
        },
      );

      /* ── 3. Navigate to /action-center and open the Data Assistant tab ─ */
      await page.goto("/action-center");
      await page.waitForLoadState("networkidle");

      const assistantTab = page.getByRole("tab", { name: /Data Assistant/i });
      await expect(assistantTab).toBeVisible({ timeout: 10_000 });
      await assistantTab.click();

      /* ── 4. Click "Instant Analysis" to generate the card ─────────────── */
      const instantAnalysisBtn = page.getByRole("button", { name: /Instant Analysis/i });
      await expect(instantAnalysisBtn).toBeVisible({ timeout: 8_000 });
      await instantAnalysisBtn.click();

      /* ── 5. Assert the card is rendered (badge text confirms InstantAnalysisCard) */
      const badge = page.getByText("Instant analysis", { exact: true });
      await expect(
        badge,
        "InstantAnalysisCard badge must be visible after generation",
      ).toBeVisible({ timeout: 10_000 });

      /* Confirm summary text from our fixture is also visible */
      await expect(
        page.getByText("Classroom Management").first(),
        "Fixture finding lead must be visible in the card",
      ).toBeVisible({ timeout: 5_000 });

      /* ── 6. Clear ALL localStorage (simulates no localStorage persistence) */
      await page.evaluate(() => {
        try { localStorage.clear(); } catch { /* storage may be blocked */ }
      });

      /* ── 7. Navigate away (full component unmount), then back ───────────── */
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      await page.goto("/action-center");
      await page.waitForLoadState("networkidle");

      /* ── 8. Re-open the Data Assistant tab ─────────────────────────────── */
      const assistantTab2 = page.getByRole("tab", { name: /Data Assistant/i });
      await expect(assistantTab2).toBeVisible({ timeout: 10_000 });
      await assistantTab2.click();

      /* ── 9. Select the session from the sessions list ──────────────────── */
      const sessionItem = page.getByText(FAKE_SESSION_TITLE);
      await expect(sessionItem).toBeVisible({ timeout: 8_000 });
      await sessionItem.click();

      /* ── 10. Assert the card is re-rendered from server data ───────────── */
      const badge2 = page.getByText("Instant analysis", { exact: true });
      await expect(
        badge2,
        "InstantAnalysisCard badge must be visible after returning — card restored from server, not localStorage",
      ).toBeVisible({ timeout: 10_000 });

      await expect(
        page.getByText("Classroom Management").first(),
        "Fixture finding lead must still be visible — data came from server message, not localStorage",
      ).toBeVisible({ timeout: 5_000 });
    },
  );
});
