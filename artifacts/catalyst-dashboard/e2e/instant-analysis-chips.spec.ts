import { test, expect } from "@playwright/test";

/**
 * Confirms that clicking an Instant Analysis suggestion chip sends a follow-up
 * message and the chip text appears as a user bubble in the chat thread.
 *
 * Background
 * ----------
 * The InstantAnalysisCard renders suggestion chips (e.g. "Which teachers need
 * support?"). Clicking a chip calls `onChipClick(text)` → `handleSendChat(text)`.
 * handleSendChat immediately pushes `{ role: "user", text }` into chatMsgs (so
 * the user bubble renders), then calls the streaming endpoint to fetch the AI
 * reply. If this handler silently breaks (e.g. the onChipClick prop is wired to
 * the wrong function, or handleSendChat has a guard that discards overrideText),
 * the user loses a key discovery path with no visible error.
 *
 * Test strategy
 * -------------
 * 1. Login as U10 (NETWORK_ADMIN — required for the Data Assistant tab).
 * 2. Register fetch mocks via addInitScript (before React mounts):
 *      POST /api/ai/chats    → fake session (skips CSRF origin check)
 *      POST /api/ai/analysis → fake structured payload with three chips
 *      POST /api/ai/chat/stream → completing stream (data chunk + [DONE])
 * 3. Navigate to /action-center, open the Data Assistant tab.
 * 4. Click "Instant Analysis" — the card renders from the mocked POST response.
 * 5. Assert the InstantAnalysisCard is visible (badge text "Instant analysis").
 * 6. Assert the first chip button is visible in the card.
 * 7. Click the chip.
 * 8. Assert the chip text appears as a user message bubble in the chat thread
 *    (distinct from the chip button — it is the second occurrence of that text).
 * 9. Assert the follow-up textarea reappears — confirms the stream completed
 *    and handleSendChat's full success path ran.
 * 10. Assert the AI reply text is visible in the thread.
 *
 * No data is written to the database — all three API calls are intercepted.
 *
 * Fake session IDs: 99_995 (this file)
 * Other specs use: 99_996 (persistence), 99_997 (fresh-state),
 *                  99_998 (copy-button), 99_999 (stop-button)
 */

const LOGIN_EMPLOYEE_ID = "U10";
const FAKE_SESSION_ID   = 99_995;

/* The chip text we click — must match one entry in FAKE_STRUCTURED.chips */
const CHIP_TEXT = "Which teachers need support?";

/* AI reply text returned by the completing stream mock */
const AI_REPLY_TEXT = "Here are the teachers who may need additional coaching support this quarter.";

const FAKE_STRUCTURED = {
  contextLine:            "Q1 data · 12 teachers · 48 observations",
  summary:                "**Overall:** The school is performing at a solid level with strengths in classroom management.",
  findings: [
    {
      type:   "leverage",
      lead:   "Classroom Management",
      detail: "9 of 12 teachers scored above the proficiency threshold.",
    },
    {
      type:   "flag",
      lead:   "Questioning Techniques",
      detail: "4 teachers scored below 0.5 — a priority growth area.",
    },
  ],
  chips:               [
    "Which teachers need support?",
    "What are the top strengths?",
    "Summarize growth areas",
  ],
  narrativeForContext:    "Q1 narrative context.",
  overdueActionStepCount: 0,
};

test.describe("Instant Analysis — chip click sends a follow-up message", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test(
    "clicking a chip pre-fills and sends the message, showing it as a user bubble",
    async ({ page }) => {
      /* ── 1. Login ─────────────────────────────────────────────────────── */
      const loginResp = await page.request.post("/api/auth/dev-login", {
        data: { employeeId: LOGIN_EMPLOYEE_ID },
      });
      expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();
      const loginBody = await loginResp.json();
      expect(loginBody.ok, "dev-login body.ok must be true").toBe(true);

      /* ── 2. Register fetch mocks before any page load ─────────────────── */
      await page.addInitScript(
        ({
          fakeSessionId,
          fakeStructured,
          aiReplyText,
        }: {
          fakeSessionId: number;
          fakeStructured: typeof FAKE_STRUCTURED;
          aiReplyText:    string;
        }) => {
          const orig = window.fetch.bind(window);

          window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url =
              typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : (input as Request).url;
            const method = (init?.method ?? "GET").toUpperCase();

            /* POST /api/ai/chats → fake session (covers both Instant Analysis
               session creation and any follow-up session creation) */
            if (
              url.includes("/api/ai/chats") &&
              !url.includes("/messages") &&
              !url.includes("/stream") &&
              method === "POST"
            ) {
              const now = new Date().toISOString();
              return new Response(
                JSON.stringify({
                  id:        fakeSessionId,
                  title:     "Instant Analysis",
                  createdAt: now,
                  updatedAt: now,
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              );
            }

            /* POST /api/ai/analysis → return fake structured with chips */
            if (url.includes("/api/ai/analysis") && method === "POST") {
              return new Response(
                JSON.stringify({ structured: fakeStructured, rubricSetSlug: "Q1" }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              );
            }

            /* POST /api/ai/chat/stream → completing stream (data + [DONE]) */
            if (url.includes("/api/ai/chat/stream") && method === "POST") {
              const encoder = new TextEncoder();
              const payload =
                `data: ${JSON.stringify(aiReplyText)}\n\n` +
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

            return orig(input, init);
          };
        },
        { fakeSessionId: FAKE_SESSION_ID, fakeStructured: FAKE_STRUCTURED, aiReplyText: AI_REPLY_TEXT },
      );

      /* ── 3. Navigate to /action-center ───────────────────────────────── */
      await page.goto("/action-center");
      await page.waitForLoadState("networkidle");

      /* ── 4. Open the Data Assistant tab ──────────────────────────────── */
      const assistantTab = page.getByRole("tab", { name: /Data Assistant/i });
      await expect(assistantTab, "Data Assistant tab must be visible").toBeVisible({ timeout: 10_000 });
      await assistantTab.click();

      /* ── 5. Click "Instant Analysis" to generate the card ───────────── */
      const instantAnalysisBtn = page.getByRole("button", { name: /Instant Analysis/i });
      await expect(instantAnalysisBtn, "Instant Analysis button must be visible").toBeVisible({ timeout: 8_000 });
      await instantAnalysisBtn.click();

      /* ── 6. Assert the card is rendered ──────────────────────────────── */
      const badge = page.getByText("Instant analysis", { exact: true });
      await expect(
        badge,
        "InstantAnalysisCard badge must be visible after generation",
      ).toBeVisible({ timeout: 10_000 });

      /* ── 7. Assert the chip button is visible in the card ────────────── */
      /* The chip is rendered as a <button> inside the InstantAnalysisCard.
         We use getByRole to find it specifically as a button to distinguish
         it from the user bubble that will appear after clicking. */
      const chipBtn = page.getByRole("button", { name: CHIP_TEXT });
      await expect(
        chipBtn.first(),
        `Chip button "${CHIP_TEXT}" must be visible in the InstantAnalysisCard`,
      ).toBeVisible({ timeout: 5_000 });

      /* ── 8. Click the chip ───────────────────────────────────────────── */
      await chipBtn.first().click();

      /* ── 9. Assert the chip text appears as a user message bubble ────── */
      /* handleSendChat immediately pushes { role: "user", text: chip }
         into chatMsgs. User message containers are rendered with the
         Tailwind class "flex-row-reverse" (right-aligned bubbles), while
         the InstantAnalysisCard chip buttons are in a normal left-aligned
         container. Scoping to .flex-row-reverse reliably targets only the
         user bubble, not the chip button in the card. */
      const userMsgContainer = page.locator("div.flex-row-reverse");
      await expect(
        userMsgContainer.getByText(CHIP_TEXT),
        `Chip text "${CHIP_TEXT}" must appear as a user message bubble in the chat thread`,
      ).toBeVisible({ timeout: 8_000 });

      /* ── 10. Assert the follow-up textarea reappears ─────────────────── */
      /* After [DONE], handleSendChat's success path commits the AI message,
         clears streamingText, and the Stop button hides → follow-up textarea
         reappears. This is the most reliable signal that the full send path ran. */
      const followUpTextarea = page.locator(
        'textarea[placeholder="Ask a follow-up question…"]',
      );
      await expect(
        followUpTextarea,
        "Follow-up textarea must reappear after the stream completes — proves chip click triggered handleSendChat successfully",
      ).toBeVisible({ timeout: 12_000 });

      /* ── 11. Assert the AI reply is visible in the thread ────────────── */
      await expect(
        page.getByText(AI_REPLY_TEXT).first(),
        "AI reply text must appear in the chat thread after chip-triggered message",
      ).toBeVisible({ timeout: 5_000 });
    },
  );
});
