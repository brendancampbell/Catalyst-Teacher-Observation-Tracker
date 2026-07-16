/**
 * ai-narrative-nested-bullets.spec.ts
 *
 * Confirms that the AINarrativeRenderer in the Action Center Data Assistant
 * panel does not introduce horizontal scroll or overflow when the AI response
 * contains deeply nested bullet points (third-level, 32 px left margin) and
 * the viewport is as narrow as 375 px — a common phone width.
 *
 * What is checked
 * ---------------
 * 1. The AI message bubble container does not overflow its parent.
 * 2. Each rendered third-level bullet row (▪ symbol, 32 px marginLeft) does
 *    not overflow its own clientWidth.
 * 3. document.documentElement does not acquire a horizontal scrollbar
 *    (scrollWidth ≤ clientWidth).
 *
 * How it works
 * ------------
 * An addInitScript() fetch mock is injected before any React code runs. It
 * intercepts the two AI endpoints:
 *
 *   POST /api/ai/chats       → returns a minimal fake session (id 99998).
 *   POST /api/ai/chat/stream → streams the NESTED_BULLET_TEXT fixture as a
 *                              series of SSE data: "…"\n\n chunks, then
 *                              sends data: [DONE]\n\n so the app commits
 *                              the message and exits streaming mode.
 *   GET /api/ai/chats/*      → returns a fake session list so the sidebar
 *                              does not error.
 *
 * All other fetch calls reach the real dev API unchanged.
 *
 * Completion detection
 * --------------------
 * Instead of waiting for the follow-up textarea (which can be off-screen at
 * 320 px heights), the beforeEach waits for FIXTURE_SENTINEL — a unique short
 * phrase that only appears after AINarrativeRenderer processes the fixture text
 * and writes it to the committed chatMsgs bubble.
 *
 * Login: Brendan Campbell (U10, NETWORK_ADMIN) — required for the
 * "Data Assistant" tab to appear in the Action Center.
 *
 * Reference
 * ---------
 * AINarrativeRenderer bullet branch — artifacts/catalyst-dashboard/src/pages/action-center.tsx
 * Bullet marginLeft = nestLevel * 16; nestLevel 2 (≥4 leading spaces) → 32 px.
 */

import { test, expect } from "@playwright/test";

const LOGIN_EMPLOYEE_ID = "U10";
const FAKE_SESSION_ID   = 99_998;

/**
 * A short unique phrase that appears only inside third-level bullet text.
 * Used as a reliable DOM sentinel that the AI message has been fully rendered.
 */
const FIXTURE_SENTINEL = "third-level-rendered-sentinel";

/**
 * AI response fixture with:
 *   • top-level bullets   (0 leading spaces → nestLevel 0, marginLeft  0 px)
 *   • second-level bullets (2 leading spaces → nestLevel 1, marginLeft 16 px)
 *   • third-level bullets  (4 leading spaces → nestLevel 2, marginLeft 32 px)
 *
 * The third-level lines contain FIXTURE_SENTINEL so the test can reliably wait
 * for them to appear in the DOM before running overflow assertions.
 * The lines are intentionally verbose so they wrap on a 375 px viewport —
 * wrapping is expected; what must not happen is scrollWidth overflow.
 */
const NESTED_BULLET_TEXT = [
  "## Instructional Quality Summary",
  "",
  "- Classroom environment and student engagement are core strengths across observed teachers",
  "  - Consistent use of structured routines supports on-task behavior during transitions",
  `    - ${FIXTURE_SENTINEL}: observers noted that three teachers maintained a 95% or higher on-task rate even during unplanned interruptions, which is an outlier worth celebrating in the next coaching cycle`,
  "  - Collaborative grouping strategies are applied in roughly 60% of observations",
  `    - ${FIXTURE_SENTINEL}: group-work quality varies — high performers use role cards and accountability checks while lower-scoring teachers rely solely on proximity monitoring`,
  "- Questioning and academic discourse remain the primary area of growth",
  "  - Only 38% of observed lessons included open-ended questions rated proficient or above",
  `    - ${FIXTURE_SENTINEL}: the sharpest gap appears in math classrooms where procedural fluency questions dominate and conceptual reasoning prompts are rare or absent across the full rubric domain`,
  "  - Wait-time after posing questions averaged under two seconds in seven of twelve recent observations",
  `    - ${FIXTURE_SENTINEL}: brief professional development on structured wait-time and think-pair-share protocols could produce measurable gains within a single coaching cycle`,
].join("\n");

const NARROW_VIEWPORTS = [
  { width: 375, height: 812, label: "375 × 812 (iPhone X)" },
  { width: 320, height: 568, label: "320 × 568 (iPhone SE 1st gen)" },
] as const;

for (const vp of NARROW_VIEWPORTS) {
  test.describe(`AI narrative nested bullets — no overflow at ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      /* ── 1. Inject fetch mock before any React code runs ──────────────
         Wraps window.fetch so AI endpoints return controlled data while all
         other requests (auth, rubrics, dashboard, etc.) reach the real server. */
      await page.addInitScript(
        ({
          nestedBulletText,
          fakeSessionId,
        }: {
          nestedBulletText: string;
          fakeSessionId: number;
        }) => {
          const originalFetch = window.fetch.bind(window);

          window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url =
              typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : (input as Request).url;
            const method = (init?.method ?? "GET").toUpperCase();

            /* ── Mock: POST /api/ai/chats (session creation) ──────────── */
            if (
              url.includes("/api/ai/chats") &&
              !url.includes("/messages") &&
              method === "POST"
            ) {
              const now = new Date().toISOString();
              return Promise.resolve(
                new Response(
                  JSON.stringify({
                    id: fakeSessionId,
                    title: "Nested Bullet Test Session",
                    createdAt: now,
                    updatedAt: now,
                  }),
                  { status: 201, headers: { "Content-Type": "application/json" } },
                ),
              );
            }

            /* ── Mock: GET /api/ai/chats/{id}/messages ───────────────── */
            /* After streaming completes the app re-fetches the session messages
               from the server via useQuery.  Without this mock the request hits
               the real API which returns 404 for our fake session, causing the
               component to overwrite chatMsgs with [] and erase the AI reply. */
            if (
              url.includes(`/api/ai/chats/${fakeSessionId}/messages`) &&
              method === "GET"
            ) {
              const now = new Date().toISOString();
              return Promise.resolve(
                new Response(
                  JSON.stringify([
                    {
                      id: 1,
                      sessionId: fakeSessionId,
                      role: "user",
                      content: "Show nested bullet findings",
                      createdAt: now,
                    },
                    {
                      id: 2,
                      sessionId: fakeSessionId,
                      role: "assistant",
                      content: nestedBulletText,
                      createdAt: now,
                    },
                  ]),
                  { status: 200, headers: { "Content-Type": "application/json" } },
                ),
              );
            }

            /* ── Mock: GET /api/ai/chats (session list) ───────────────── */
            if (url.includes("/api/ai/chats") && method === "GET") {
              const now = new Date().toISOString();
              return Promise.resolve(
                new Response(
                  JSON.stringify([
                    {
                      id: fakeSessionId,
                      title: "Nested Bullet Test Session",
                      createdAt: now,
                      updatedAt: now,
                    },
                  ]),
                  { status: 200, headers: { "Content-Type": "application/json" } },
                ),
              );
            }

            /* ── Mock: POST /api/ai/chat/stream ───────────────────────── */
            if (url.includes("/api/ai/chat/stream")) {
              const encoder = new TextEncoder();
              const text = nestedBulletText;

              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  /* Delay slightly so the typing indicator appears first,
                     then send the full fixture as one chunk and close cleanly. */
                  setTimeout(() => {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(text)}\n\n`),
                    );
                    /* [DONE] tells streamAIChat to return, committing the text
                       to chatMsgs and clearing streamingText. */
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                  }, 250);
                },
              });

              return Promise.resolve(
                new Response(stream, {
                  status: 200,
                  headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                  },
                }),
              );
            }

            /* All other requests reach the real API server unchanged. */
            return originalFetch(input, init);
          };
        },
        { nestedBulletText: NESTED_BULLET_TEXT, fakeSessionId: FAKE_SESSION_ID },
      );

      /* ── 2. Authenticate via dev-login ─────────────────────────────── */
      const loginResp = await page.request.post("/api/auth/dev-login", {
        data: { employeeId: LOGIN_EMPLOYEE_ID },
      });
      expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();
      const loginBody = await loginResp.json();
      expect(loginBody.ok, "dev-login body.ok must be true").toBe(true);

      /* ── 3. Navigate to the Action Center ─────────────────────────── */
      await page.goto("/action-center");
      await page.waitForLoadState("networkidle");

      /* ── 4. Open the Data Assistant tab ─────────────────────────────
         At narrow viewports (< 640 px = Tailwind sm) the tab label is
         truncated to the first word ("Data") via sm:hidden / hidden sm:inline
         span pairs. We match on /Data/i which covers both "Data" and
         "Data Assistant". The first match is the Data Assistant tab since
         no other tab label starts with "Data". */
      const assistantTab = page.getByRole("tab", { name: /Data/i }).first();
      await expect(assistantTab).toBeVisible({ timeout: 10_000 });
      await assistantTab.click();

      /* ── 5. Send a question to trigger the mocked AI response ──────── */
      const initialTextarea = page.locator(
        'textarea[placeholder="Ask about your school\'s observation data…"]',
      );
      await expect(initialTextarea).toBeVisible({ timeout: 8_000 });
      await initialTextarea.fill("Show nested bullet findings");
      await initialTextarea.press("Enter");

      /* ── 6. Wait for the fixture sentinel text to appear in the DOM ──
         This phrase only appears after streamAIChat commits the message
         to chatMsgs and AINarrativeRenderer processes the fixture text,
         so its presence guarantees the third-level bullet divs exist. */
      await expect(page.locator(`text=${FIXTURE_SENTINEL}`).first()).toBeVisible({
        timeout: 20_000,
      });
    });

    /* ── Test 1: AI bubble container has no horizontal overflow ───────── */
    test("AI message bubble does not overflow its container", async ({ page }) => {
      /* The AINarrativeRenderer root div is inside the committed chatMsgs
         bubble. We find it by locating the sentinel text and walking up
         to the nearest flex ancestor that spans the full bubble width. */
      const sentinelEl = page.locator(`text=${FIXTURE_SENTINEL}`).first();
      await expect(sentinelEl).toBeVisible({ timeout: 5_000 });

      const result = await sentinelEl.evaluate((el) => {
        /* Walk up until we find the scrollable/flex chat message container.
           We go up several levels to reach the outer bubble wrapper. */
        let node: Element | null = el;
        for (let i = 0; i < 8 && node; i++) {
          node = node.parentElement;
          if (!node) break;
          const style = window.getComputedStyle(node);
          /* The bubble wrapper is the first ancestor with explicit padding
             and a border (the white rounded card). */
          if (style.borderRadius && style.borderRadius !== "0px" && style.border !== "none") {
            return {
              found: true,
              overflows: node.scrollWidth > node.clientWidth,
              scrollWidth: node.scrollWidth,
              clientWidth: node.clientWidth,
              tag: node.tagName,
            };
          }
        }
        /* Fallback: check the direct parent */
        const parent = el.parentElement;
        if (!parent) return { found: false, overflows: false, scrollWidth: 0, clientWidth: 0, tag: "" };
        return {
          found: true,
          overflows: parent.scrollWidth > parent.clientWidth,
          scrollWidth: parent.scrollWidth,
          clientWidth: parent.clientWidth,
          tag: parent.tagName,
        };
      });

      expect(
        result.overflows,
        `AI bubble ancestor overflows at ${vp.width}px: scrollWidth=${result.scrollWidth}, clientWidth=${result.clientWidth}`,
      ).toBe(false);
    });

    /* ── Test 2: third-level bullet rows do not overflow ──────────────── */
    test("no deeply nested bullet row overflows horizontally", async ({ page }) => {
      /* Find every element that contains the sentinel text (each third-level
         bullet has the sentinel phrase) and measure its flex-row container. */
      const results = await page.evaluate((sentinel) => {
        const sentinelEls = Array.from(document.querySelectorAll("*")).filter(
          (el) =>
            el.childNodes.length > 0 &&
            Array.from(el.childNodes).some(
              (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes(sentinel),
            ),
        );

        return sentinelEls.map((el, index) => {
          /* The bullet flex row is the nearest ancestor with display:flex */
          let node: Element | null = el;
          while (node && window.getComputedStyle(node).display !== "flex") {
            node = node.parentElement;
          }
          const target = node ?? el;
          return {
            index,
            overflows: target.scrollWidth > target.clientWidth,
            scrollWidth: target.scrollWidth,
            clientWidth: target.clientWidth,
            marginLeft: window.getComputedStyle(target).marginLeft,
          };
        });
      }, FIXTURE_SENTINEL);

      expect(
        results.length,
        "at least one third-level bullet (sentinel text) must be present in the DOM",
      ).toBeGreaterThan(0);

      for (const r of results) {
        expect(
          r.overflows,
          `Third-level bullet[${r.index}] overflows at ${vp.width}px: ` +
            `marginLeft=${r.marginLeft}, scrollWidth=${r.scrollWidth}, clientWidth=${r.clientWidth}`,
        ).toBe(false);
      }
    });

    /* ── Test 3: page-level no horizontal scrollbar ───────────────────── */
    test("page body does not acquire a horizontal scrollbar", async ({ page }) => {
      const result = await page.evaluate(() => ({
        overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(
        result.overflows,
        `document overflows at ${vp.width}px: scrollWidth=${result.scrollWidth}, clientWidth=${result.clientWidth}`,
      ).toBe(false);
    });
  });
}
