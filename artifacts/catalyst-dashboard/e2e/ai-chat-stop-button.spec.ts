import { test, expect } from "@playwright/test";

/**
 * Confirms that the AI Chat "Stop generating" button in the Action Center:
 *
 *   1. Appears while the AI response is being streamed.
 *   2. When clicked, aborts the in-flight stream.
 *   3. Commits whatever partial text had already arrived as a permanent
 *      AI message bubble (content is NOT lost).
 *   4. Re-enables the chat input textarea so the user can send another
 *      message immediately.
 *
 * Network strategy
 * ----------------
 * A fetch mock is injected via addInitScript() so it wraps window.fetch
 * before any React code runs.  The mock intercepts:
 *
 *   POST /api/ai/chats       → returns a fake session immediately.
 *                              (Required to avoid the CSRF origin check on
 *                              cross-port Playwright requests — same
 *                              isolation used by the dev-mode login helper.)
 *
 *   POST /api/ai/chat/stream → returns a ReadableStream that:
 *                                · sends one SSE data chunk (PARTIAL_TEXT)
 *                                  after 300 ms, so the typing indicator
 *                                  renders first (chatTyping → true),
 *                                · leaves the stream open indefinitely
 *                                  (no [DONE] sentinel, never closed),
 *                                  causing the app's reader.read() to block
 *                                  and the Stop button to remain visible.
 *                                · when the AbortSignal fires (Stop clicked),
 *                                  errors the stream so reader.read() rejects
 *                                  cleanly instead of hanging.
 *
 * All other fetch calls (auth, data queries) continue to reach the real
 * dev-mode API server unchanged.
 *
 * Login: Brendan Campbell (U10, NETWORK_ADMIN) — required because the
 * "Data Assistant" tab is NETWORK_ADMIN-only.
 */

const LOGIN_EMPLOYEE_ID = "U10";
const PARTIAL_TEXT      = "Partial mock response from the AI stream";
const FAKE_SESSION_ID   = 99_999;

test.describe("Action Center — AI Chat Stop button", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    /* ── 1. Register fetch mock BEFORE any page load ────────────────────
       addInitScript scripts run at document-creation time, before any other
       script executes, so window.fetch is already wrapped when React boots. */
    await page.addInitScript(
      ({ partialText, fakeSessionId }: { partialText: string; fakeSessionId: number }) => {
        const originalFetch = window.fetch.bind(window);

        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : (input as Request).url;

          /* ── Mock: POST /api/ai/chats (session creation) ──────────────
             Returns a fake session instantly.  This sidesteps the CSRF
             origin check that blocks browser-originated POST requests when
             the Playwright client is on a different localhost port than the
             API server's CORS allowlist. */
          if (url.includes("/api/ai/chats") && !url.includes("/messages") && (init?.method ?? "GET").toUpperCase() === "POST") {
            const now = new Date().toISOString();
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id:        fakeSessionId,
                  title:     "Test Chat",
                  createdAt: now,
                  updatedAt: now,
                }),
                {
                  status:  201,
                  headers: { "Content-Type": "application/json" },
                },
              ),
            );
          }

          /* ── Mock: POST /api/ai/chat/stream ───────────────────────────
             Returns a ReadableStream that emits one SSE chunk after 300 ms
             and then blocks forever.  This gives the test a reliable window
             to click "Stop generating" while streamingText is visible. */
          if (url.includes("/api/ai/chat/stream")) {
            const encoder = new TextEncoder();

            const stream = new ReadableStream<Uint8Array>({
              start(controller) {
                /* Delay the first chunk so the typing-indicator bounce dots
                   render first (chatTyping=true), then the chunk transitions
                   the UI to the live streaming bubble (streamingText≠""). */
                const timer = setTimeout(() => {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(partialText)}\n\n`),
                  );
                  /* Intentionally do NOT send [DONE] or close the stream.
                     The app's reader.read() blocks here, keeping the Stop
                     button visible until the test clicks it. */
                }, 300);

                /* When the AbortController fires (user clicked Stop), cancel
                   the pending timer and error the stream so reader.read()
                   rejects cleanly instead of hanging the test runner. */
                const signal = init?.signal;
                if (signal) {
                  signal.addEventListener("abort", () => {
                    clearTimeout(timer);
                    controller.error(
                      new DOMException("The operation was aborted.", "AbortError"),
                    );
                  });
                }
              },
            });

            return Promise.resolve(
              new Response(stream, {
                status: 200,
                headers: {
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                  Connection:     "keep-alive",
                },
              }),
            );
          }

          /* All other requests reach the real API server unchanged. */
          return originalFetch(input, init);
        };
      },
      { partialText: PARTIAL_TEXT, fakeSessionId: FAKE_SESSION_ID },
    );

    /* ── 2. Dev login (direct API call — no page navigation) ────────────
       Cookies are stored in the Playwright browser context and sent with the
       subsequent page.goto() navigation automatically. */
    const loginResp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: LOGIN_EMPLOYEE_ID },
    });
    expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();
    const loginBody = await loginResp.json();
    expect(loginBody.ok, "dev-login body.ok must be true").toBe(true);

    /* ── 3. Navigate to the Action Center ───────────────────────────── */
    await page.goto("/action-center");
    await page.waitForLoadState("networkidle");
  });

  test(
    "clicks Stop while streaming text is visible and confirms partial text is committed",
    async ({ page }) => {
      /* ── Navigate to the Data Assistant (analysis) tab ───────────────
         The tab is rendered only for NETWORK_ADMIN users; U10 qualifies. */
      const assistantTab = page.getByRole("tab", { name: /Data Assistant/i });
      await expect(assistantTab).toBeVisible({ timeout: 10_000 });
      await assistantTab.click();

      /* ── Empty-state input must be visible (no active chat session yet) */
      const initialTextarea = page.locator(
        'textarea[placeholder="Ask about your school\'s observation data…"]',
      );
      await expect(initialTextarea).toBeVisible({ timeout: 8_000 });

      /* ── Type a message and submit ────────────────────────────────── */
      await initialTextarea.fill(
        "What are the biggest coaching opportunities this quarter?",
      );
      await initialTextarea.press("Enter");

      /* ── Phase 1: typing indicator (chatTyping = true) ────────────────
         The Stop button appears immediately when chatTyping is set, before
         any streaming text has arrived. */
      const stopBtn = page.locator('button:has-text("Stop generating")');
      await expect(stopBtn).toBeVisible({ timeout: 10_000 });

      /* ── Phase 2: streaming text visible ─────────────────────────────
         ~300 ms after the message is sent the mock emits its SSE chunk.
         The component transitions from the bouncing-dots indicator to the
         live streaming bubble showing the partial text. */
      const streamingTextLocator = page.locator(`text=${PARTIAL_TEXT}`).first();
      await expect(streamingTextLocator).toBeVisible({ timeout: 5_000 });

      /* The Stop button must still be visible while streamingText is set. */
      await expect(stopBtn).toBeVisible();

      /* ── Click Stop ──────────────────────────────────────────────── */
      await stopBtn.click();

      /* ── Assertions ─────────────────────────────────────────────── */

      /* 1. Stop button must disappear (chatTyping=false, streamingText=""). */
      await expect(stopBtn).not.toBeVisible({ timeout: 5_000 });

      /* 2. The chat textarea must reappear so the user can type a new
            message immediately after stopping. */
      const followUpTextarea = page.locator(
        'textarea[placeholder="Ask a follow-up question…"]',
      );
      await expect(followUpTextarea).toBeVisible({ timeout: 5_000 });

      /* 3. The partial text must be committed as a permanent AI message
            bubble exactly ONCE — no duplicate bubbles.
            handleStopGeneration() commits streamingText; the fixed
            streamAIChat now re-throws AbortError so handleSendChat's
            catch block exits early and does NOT commit a second copy. */
      await expect(
        page.locator(`text=${PARTIAL_TEXT}`),
      ).toHaveCount(1, { timeout: 3_000 });

      /* 4. The user's original question must still be visible above the
            AI reply (message history is intact after stopping). */
      await expect(
        page
          .locator(
            "text=What are the biggest coaching opportunities this quarter?",
          )
          .first(),
      ).toBeVisible();
    },
  );
});
