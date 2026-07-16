import { test, expect } from "@playwright/test";

/**
 * Confirms that the Copy button on AI chat bubbles behaves correctly
 * relative to the streaming state:
 *
 *   Test 1 — During streaming
 *     · The streaming bubble (streamingText ≠ "") renders raw text with a
 *       pulsing cursor but NO Copy button.
 *     · A stream mock that sends one chunk then hangs open keeps the
 *       streaming bubble visible long enough to assert absence.
 *
 *   Test 2 — After stream completes
 *     · When the server signals [DONE], handleSendChat's success path
 *       commits the full text into chatMsgs and clears streamingText.
 *     · The committed AI bubble renders with aria-label="Copy message".
 *     · Clicking Copy shows the "Copied!" tooltip.
 *
 * Network strategy
 * ----------------
 * Each test registers its own addInitScript (before page.goto) that
 * intercepts the two AI endpoints:
 *
 *   POST /api/ai/chats       → fake session (sidesteps CSRF origin check)
 *   POST /api/ai/chat/stream → ReadableStream whose behaviour differs
 *                               between the two tests (see below).
 *
 * The beforeEach performs only the dev-login so that each test can
 * inject its own fetch mock before calling page.goto().
 *
 * Login: U10 (Brendan Campbell, NETWORK_ADMIN) — required for the
 * "Data Assistant" tab.
 */

const LOGIN_EMPLOYEE_ID = "U10";
const FAKE_SESSION_ID   = 99_998;
const COMPLETE_TEXT     = "Complete AI response for copy button test.";

test.describe("Action Center — AI Chat Copy button", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    /* Dev-login only.  No page.goto() here — each test registers its own
       addInitScript first, then navigates. */
    const loginResp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: LOGIN_EMPLOYEE_ID },
    });
    expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();
    const body = await loginResp.json();
    expect(body.ok, "dev-login body.ok must be true").toBe(true);
  });

  /* ─────────────────────────────────────────────────────────────────── */
  test(
    "Copy button is absent while the AI response is still streaming",
    async ({ page }) => {
      /* ── Fetch mock: hang-open stream (never sends [DONE]) ──────────
         Sends one SSE data chunk after 200 ms so the streaming bubble
         becomes visible, then keeps the stream open indefinitely.
         The AbortSignal listener errors the stream on page unload/abort. */
      await page.addInitScript(
        ({
          completeText,
          fakeSessionId,
        }: {
          completeText: string;
          fakeSessionId: number;
        }) => {
          const originalFetch = window.fetch.bind(window);

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

            /* Session creation — fake response to skip CSRF check */
            if (
              url.includes("/api/ai/chats") &&
              !url.includes("/messages") &&
              (init?.method ?? "GET").toUpperCase() === "POST"
            ) {
              const now = new Date().toISOString();
              return new Response(
                JSON.stringify({
                  id: fakeSessionId,
                  title: "Test Chat",
                  createdAt: now,
                  updatedAt: now,
                }),
                { status: 201, headers: { "Content-Type": "application/json" } },
              );
            }

            /* Streaming endpoint — hang-open mock */
            if (url.includes("/api/ai/chat/stream")) {
              const encoder = new TextEncoder();
              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  /* Emit one data chunk after 200 ms, then hang. */
                  const timer = setTimeout(() => {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify(completeText)}\n\n`,
                      ),
                    );
                    /* No [DONE] — stream stays open so the streaming
                       bubble remains visible for the assertion. */
                  }, 200);

                  const signal = init?.signal;
                  if (signal) {
                    signal.addEventListener("abort", () => {
                      clearTimeout(timer);
                      controller.error(
                        new DOMException(
                          "The operation was aborted.",
                          "AbortError",
                        ),
                      );
                    });
                  }
                },
              });
              return new Response(stream, {
                status: 200,
                headers: {
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                  Connection: "keep-alive",
                },
              });
            }

            return originalFetch(input, init);
          };
        },
        { completeText: COMPLETE_TEXT, fakeSessionId: FAKE_SESSION_ID },
      );

      await page.goto("/action-center");
      await page.waitForLoadState("networkidle");

      /* Navigate to Data Assistant tab */
      const assistantTab = page.getByRole("tab", { name: /Data Assistant/i });
      await expect(assistantTab).toBeVisible({ timeout: 10_000 });
      await assistantTab.click();

      const initialTextarea = page.locator(
        'textarea[placeholder="Ask about your school\'s observation data…"]',
      );
      await expect(initialTextarea).toBeVisible({ timeout: 8_000 });

      /* Send a message to start the stream */
      await initialTextarea.fill(
        "What are the key coaching priorities this quarter?",
      );
      await initialTextarea.press("Enter");

      /* Wait for the streaming bubble to appear — confirms the mock
         chunk arrived and streamingText is now non-empty. */
      await expect(
        page.locator(`text=${COMPLETE_TEXT}`).first(),
      ).toBeVisible({ timeout: 8_000 });

      /* Stop button should be visible (stream is in progress) */
      await expect(
        page.locator('button:has-text("Stop generating")'),
      ).toBeVisible();

      /* Core assertion: while streaming, NO Copy button in the DOM.
         The streaming bubble renders raw text with a cursor but omits
         the aria-label="Copy message" button present on committed msgs. */
      await expect(
        page.locator('[aria-label="Copy message"]'),
      ).not.toBeVisible();
    },
  );

  /* ─────────────────────────────────────────────────────────────────── */
  test(
    "Copy button appears on the committed message and shows Copied! when clicked",
    async ({ page }) => {
      /* ── Fetch mock: completing stream (sends [DONE] after the chunk) ──
         After 100 ms the mock enqueues both the text chunk and the [DONE]
         sentinel in one write.  streamAIChat returns meta, handleSendChat's
         success path commits the message, and the streaming bubble clears. */
      await page.addInitScript(
        ({
          completeText,
          fakeSessionId,
        }: {
          completeText: string;
          fakeSessionId: number;
        }) => {
          const originalFetch = window.fetch.bind(window);

          /* Mock clipboard so writeText always resolves — headless Chromium
             may not have clipboard-write permission and would otherwise
             reject the Promise, preventing the "Copied!" tooltip.
             The argument is stored in window.__copiedText so the test
             can read it back with page.evaluate() and assert correctness. */
          try {
            Object.defineProperty(navigator, "clipboard", {
              configurable: true,
              value: {
                writeText: (text: string) => {
                  (window as typeof window & { __copiedText: string }).__copiedText = text;
                  return Promise.resolve();
                },
              },
            });
          } catch (_e) {
            /* Ignore — some browsers block redefining clipboard. */
          }

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

            /* Session creation */
            if (
              url.includes("/api/ai/chats") &&
              !url.includes("/messages") &&
              (init?.method ?? "GET").toUpperCase() === "POST"
            ) {
              const now = new Date().toISOString();
              return new Response(
                JSON.stringify({
                  id: fakeSessionId,
                  title: "Test Chat",
                  createdAt: now,
                  updatedAt: now,
                }),
                { status: 201, headers: { "Content-Type": "application/json" } },
              );
            }

            /* Streaming endpoint — completing stream */
            if (url.includes("/api/ai/chat/stream")) {
              const encoder = new TextEncoder();
              /* Both the data chunk and [DONE] are sent together so
                 streamAIChat processes them in one read and returns. */
              const payload =
                `data: ${JSON.stringify(completeText)}\n\n` +
                `data: [DONE]\n\n`;
              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  setTimeout(() => {
                    controller.enqueue(encoder.encode(payload));
                    controller.close();
                  }, 100);
                },
              });
              return new Response(stream, {
                status: 200,
                headers: {
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                },
              });
            }

            return originalFetch(input, init);
          };
        },
        { completeText: COMPLETE_TEXT, fakeSessionId: FAKE_SESSION_ID },
      );

      await page.goto("/action-center");
      await page.waitForLoadState("networkidle");

      /* Navigate to Data Assistant tab */
      const assistantTab = page.getByRole("tab", { name: /Data Assistant/i });
      await expect(assistantTab).toBeVisible({ timeout: 10_000 });
      await assistantTab.click();

      const initialTextarea = page.locator(
        'textarea[placeholder="Ask about your school\'s observation data…"]',
      );
      await expect(initialTextarea).toBeVisible({ timeout: 8_000 });

      /* Send the message */
      await initialTextarea.fill(
        "What are the key coaching priorities this quarter?",
      );
      await initialTextarea.press("Enter");

      /* After [DONE], the Stop button disappears and the follow-up
         textarea reappears — reliable signal that the message is committed. */
      const followUpTextarea = page.locator(
        'textarea[placeholder="Ask a follow-up question…"]',
      );
      await expect(followUpTextarea).toBeVisible({ timeout: 10_000 });

      /* The committed AI message bubble must be visible */
      await expect(
        page.locator(`text=${COMPLETE_TEXT}`).first(),
      ).toBeVisible({ timeout: 5_000 });

      /* Core assertion 1: Copy button is present on the committed bubble */
      const copyBtn = page.locator('[aria-label="Copy message"]');
      await expect(copyBtn).toBeVisible({ timeout: 3_000 });

      /* Core assertion 2: clicking Copy shows the "Copied!" tooltip */
      await copyBtn.click();
      await expect(page.locator("text=Copied!")).toBeVisible({
        timeout: 3_000,
      });

      /* Core assertion 3: the text written to the clipboard is the full
         committed message content.  The component strips markdown before
         writing (bold markers, heading prefixes, excess blank lines).
         COMPLETE_TEXT contains no markdown so its plain form equals itself.
         window.__copiedText is populated by the clipboard mock in addInitScript. */
      const copiedText = await page.evaluate(
        () => (window as typeof window & { __copiedText?: string }).__copiedText,
      );
      expect(copiedText).toBe(COMPLETE_TEXT);
    },
  );
});
