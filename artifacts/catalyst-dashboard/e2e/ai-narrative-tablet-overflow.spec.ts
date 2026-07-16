/**
 * ai-narrative-tablet-overflow.spec.ts
 *
 * Confirms that the AINarrativeRenderer in the Action Center Data Assistant
 * panel does not introduce horizontal scroll or overflow at tablet and mid-size
 * screen widths (768 px and 1024 px).
 *
 * What is checked
 * ---------------
 * 1. h2 headings (Bebas Neue font, yellow underline) do not overflow.
 * 2. h3 sub-headings (Libre Franklin, yellow left accent bar) do not overflow.
 * 3. Markdown table wrapper (overflowX: auto container) does not overflow.
 * 4. Individual table cells do not overflow their column widths.
 * 5. All bullet nesting levels (0 / 16 / 32 px marginLeft) do not overflow.
 * 6. The page body (documentElement) does not acquire a horizontal scrollbar.
 *
 * How it works
 * ------------
 * Same fetch-mock strategy as ai-narrative-nested-bullets.spec.ts — an
 * addInitScript() intercept is injected before React runs.  It handles:
 *
 *   POST /api/ai/chats          → fake session (id 99_997)
 *   POST /api/ai/chat/stream    → streams TABLET_FIXTURE_TEXT via SSE
 *   GET  /api/ai/chats/*        → fake session list
 *   GET  /api/ai/chats/{id}/messages → returns the committed messages so the
 *                                       useQuery re-fetch doesn't wipe chatMsgs
 *
 * Completion detection
 * --------------------
 * TABLE_SENTINEL appears only inside the markdown table cell text; its presence
 * in the DOM guarantees that the full fixture (including headings and table) has
 * been committed and rendered by AINarrativeRenderer.
 *
 * Login: Brendan Campbell (U10, NETWORK_ADMIN) — required for the
 * "Data Assistant" tab to appear in the Action Center.
 *
 * Reference
 * ---------
 * AINarrativeRenderer — artifacts/catalyst-dashboard/src/pages/action-center.tsx
 *   h2 branch  → span with fontFamily Bebas Neue, display:inline-block, borderBottom yellow
 *   h3 branch  → div with borderLeft 3px yellow, paddingLeft 8
 *   table      → div with overflowX:auto wrapping a <table>
 *   bullets    → nestLevel * 16 px marginLeft on the flex row
 */

import { test, expect } from "@playwright/test";

const LOGIN_EMPLOYEE_ID = "U10";
const FAKE_SESSION_ID   = 99_997;

/**
 * A unique phrase that appears only inside a markdown table cell.
 * Used as the DOM sentinel that AINarrativeRenderer has fully committed and
 * rendered the entire fixture — including headings, table, and bullets.
 */
const TABLE_SENTINEL = "tablet-overflow-table-sentinel";

/**
 * Fixture text exercising every AINarrativeRenderer rendering branch
 * that the task asks to verify:
 *
 *   • ## h2 heading  (Bebas Neue, yellow underline)
 *   • ### h3 heading (Libre Franklin, yellow left accent bar)
 *   • markdown table (overflowX:auto wrapper + <table>)
 *   • top-level bullet       (nestLevel 0, marginLeft  0 px)
 *   • second-level bullet    (nestLevel 1, marginLeft 16 px)
 *   • third-level bullet     (nestLevel 2, marginLeft 32 px)
 *
 * The table cells contain TABLE_SENTINEL so we can wait for them in the DOM.
 * Long label text is used in headings and bullets to encourage wrapping on
 * narrower viewports — wrapping is fine; overflow (scrollWidth > clientWidth)
 * is the failure condition.
 */
const TABLET_FIXTURE_TEXT = [
  "## Instructional Quality — Tablet Overflow Verification Report",
  "",
  "### Classroom Environment and Student Engagement Findings",
  "",
  "Overview of observed patterns across all grade levels and subject areas:",
  "",
  `| Domain | Avg Score | ${TABLE_SENTINEL} Trend | Notes |`,
  `| --- | --- | --- | --- |`,
  `| Classroom Environment | 3.4 | ${TABLE_SENTINEL} Improving | Structured routines observed in 82% of classrooms |`,
  `| Questioning & Discourse | 2.7 | ${TABLE_SENTINEL} Stable | Open-ended questions below proficiency threshold in math |`,
  `| Student Engagement | 3.1 | ${TABLE_SENTINEL} Improving | On-task rates exceeded 90% in 9 of 12 recent walkthroughs |`,
  `| Feedback & Assessment | 2.9 | ${TABLE_SENTINEL} Declining | Formative checks absent in 40% of observed lessons |`,
  "",
  "## Key Findings and Coaching Priorities",
  "",
  "### Priority Areas for Immediate Focus",
  "",
  "- Classroom routines and transitions remain a core strength across the school",
  "  - Structured entry and exit procedures are in place for the majority of classrooms",
  "    - Third-level detail: three teachers maintained 95% on-task rates even during unplanned interruptions throughout the full observation window",
  "  - Collaborative grouping strategies are applied in roughly 60% of observations",
  "    - Third-level detail: role cards and accountability checks distinguish high-performing group work from proximity-only monitoring",
  "- Questioning quality is the primary area requiring coaching support this cycle",
  "  - Only 38% of observed lessons included open-ended questions rated at proficient or above",
  "    - Third-level detail: the sharpest gap appears in math classrooms where procedural fluency questions dominate the full observation window",
  "  - Wait-time after posing questions averaged under two seconds in seven of twelve recent observations",
  "    - Third-level detail: structured think-pair-share protocols could produce measurable gains within a single focused coaching cycle",
].join("\n");

const TABLET_VIEWPORTS = [
  { width: 768,  height: 1024, label: "768 × 1024 (iPad portrait)"   },
  { width: 1024, height: 768,  label: "1024 × 768 (iPad landscape)"  },
] as const;

for (const vp of TABLET_VIEWPORTS) {
  test.describe(`AI narrative tablet overflow — no overflow at ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      /* ── 1. Inject fetch mock before any React code runs ──────────────── */
      await page.addInitScript(
        ({
          fixtureText,
          fakeSessionId,
        }: {
          fixtureText: string;
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
                    title: "Tablet Overflow Test Session",
                    createdAt: now,
                    updatedAt: now,
                  }),
                  { status: 201, headers: { "Content-Type": "application/json" } },
                ),
              );
            }

            /* ── Mock: GET /api/ai/chats/{id}/messages ────────────────── */
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
                      content: "Show tablet overflow verification",
                      createdAt: now,
                    },
                    {
                      id: 2,
                      sessionId: fakeSessionId,
                      role: "assistant",
                      content: fixtureText,
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
                      title: "Tablet Overflow Test Session",
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

              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  setTimeout(() => {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(fixtureText)}\n\n`),
                    );
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

            return originalFetch(input, init);
          };
        },
        { fixtureText: TABLET_FIXTURE_TEXT, fakeSessionId: FAKE_SESSION_ID },
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

      /* ── 4. Open the Data Assistant tab ──────────────────────────────
         At tablet widths (≥ 640 px Tailwind sm breakpoint) the full label
         "Data Assistant" is shown; /Data/i matches both variants safely. */
      const assistantTab = page.getByRole("tab", { name: /Data/i }).first();
      await expect(assistantTab).toBeVisible({ timeout: 10_000 });
      await assistantTab.click();

      /* ── 5. Send a question to trigger the mocked AI response ──────── */
      const initialTextarea = page.locator(
        'textarea[placeholder="Ask about your school\'s observation data…"]',
      );
      await expect(initialTextarea).toBeVisible({ timeout: 8_000 });
      await initialTextarea.fill("Show tablet overflow verification");
      await initialTextarea.press("Enter");

      /* ── 6. Wait for the table sentinel text to appear in the DOM ────
         TABLE_SENTINEL appears inside rendered table cells, so its
         presence guarantees the full fixture has been committed and
         AINarrativeRenderer has processed all headings and the table. */
      await expect(page.locator(`text=${TABLE_SENTINEL}`).first()).toBeVisible({
        timeout: 20_000,
      });
    });

    /* ── Test 1: h2 headings (Bebas Neue) do not overflow ──────────────── */
    test("h2 headings rendered with Bebas Neue do not overflow", async ({ page }) => {
      /* AINarrativeRenderer renders ## headings as a <div> containing a <span>
         with fontFamily Bebas Neue. We locate those spans by their computed
         font-family and measure scrollWidth vs clientWidth. */
      const results = await page.evaluate(() => {
        const allSpans = Array.from(document.querySelectorAll("span"));
        const bebasSpans = allSpans.filter((el) =>
          window.getComputedStyle(el).fontFamily.toLowerCase().includes("bebas"),
        );
        return bebasSpans.map((el, i) => ({
          index: i,
          overflows: el.scrollWidth > el.clientWidth,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          text: (el.textContent ?? "").slice(0, 60),
        }));
      });

      expect(
        results.length,
        "at least one Bebas Neue heading span must be present in the DOM",
      ).toBeGreaterThan(0);

      for (const r of results) {
        expect(
          r.overflows,
          `Bebas Neue heading[${r.index}] "${r.text}" overflows at ${vp.width}px: ` +
            `scrollWidth=${r.scrollWidth}, clientWidth=${r.clientWidth}`,
        ).toBe(false);
      }
    });

    /* ── Test 2: h3 headings (yellow bar) do not overflow ──────────────── */
    test("h3 headings with yellow left accent bar do not overflow", async ({ page }) => {
      /* AINarrativeRenderer renders ### headings as a <div> with
         borderLeft: "3px solid <yellow>" and paddingLeft: 8. We locate
         those divs by checking for a yellow left border in computed style. */
      const results = await page.evaluate(() => {
        const allDivs = Array.from(document.querySelectorAll("div"));
        const h3Divs = allDivs.filter((el) => {
          const style = window.getComputedStyle(el);
          const borderLeft = style.borderLeftStyle;
          const borderWidth = parseFloat(style.borderLeftWidth);
          return borderLeft === "solid" && borderWidth === 3;
        });
        return h3Divs.map((el, i) => ({
          index: i,
          overflows: el.scrollWidth > el.clientWidth,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          text: (el.textContent ?? "").slice(0, 60),
        }));
      });

      expect(
        results.length,
        "at least one h3 yellow-bar heading div must be present in the DOM",
      ).toBeGreaterThan(0);

      for (const r of results) {
        expect(
          r.overflows,
          `h3 heading[${r.index}] "${r.text}" overflows at ${vp.width}px: ` +
            `scrollWidth=${r.scrollWidth}, clientWidth=${r.clientWidth}`,
        ).toBe(false);
      }
    });

    /* ── Test 3: markdown table wrapper does not overflow ──────────────── */
    test("markdown table wrapper does not overflow horizontally", async ({ page }) => {
      /* AINarrativeRenderer wraps tables in a <div style="overflowX:auto">.
         We find those wrappers and check the <table> inside for overflow.
         The wrapper itself may scroll (that's intended); what we verify is
         that the wrapper div does NOT overflow its own parent container. */
      const results = await page.evaluate(() => {
        const allDivs = Array.from(document.querySelectorAll("div"));
        const tableWrappers = allDivs.filter((el) => {
          const style = window.getComputedStyle(el);
          return (
            (style.overflowX === "auto" || style.overflowX === "scroll") &&
            el.querySelector("table") !== null
          );
        });
        return tableWrappers.map((el, i) => {
          const parent = el.parentElement;
          return {
            index: i,
            wrapperOverflows: el.scrollWidth > el.clientWidth,
            wrapperScrollWidth: el.scrollWidth,
            wrapperClientWidth: el.clientWidth,
            parentOverflows: parent
              ? parent.scrollWidth > parent.clientWidth
              : false,
            parentScrollWidth: parent?.scrollWidth ?? 0,
            parentClientWidth: parent?.clientWidth ?? 0,
          };
        });
      });

      expect(
        results.length,
        "at least one overflowX:auto table wrapper must be present in the DOM",
      ).toBeGreaterThan(0);

      for (const r of results) {
        expect(
          r.parentOverflows,
          `Table wrapper[${r.index}] parent overflows at ${vp.width}px: ` +
            `scrollWidth=${r.parentScrollWidth}, clientWidth=${r.parentClientWidth}`,
        ).toBe(false);
      }
    });

    /* ── Test 4: individual table cells do not overflow ────────────────── */
    test("table cells rendered by AINarrativeRenderer do not overflow", async ({ page }) => {
      const results = await page.evaluate((sentinel) => {
        /* Find the tables that contain our sentinel text — these are the ones
           rendered by AINarrativeRenderer from the fixture, not unrelated tables. */
        const allTables = Array.from(document.querySelectorAll("table"));
        const fixtureTables = allTables.filter((t) =>
          t.textContent?.includes(sentinel),
        );

        const cellResults: Array<{
          tableIndex: number;
          cellIndex: number;
          overflows: boolean;
          scrollWidth: number;
          clientWidth: number;
        }> = [];

        fixtureTables.forEach((table, ti) => {
          const cells = Array.from(table.querySelectorAll("td, th"));
          cells.forEach((cell, ci) => {
            cellResults.push({
              tableIndex: ti,
              cellIndex: ci,
              overflows: cell.scrollWidth > cell.clientWidth,
              scrollWidth: cell.scrollWidth,
              clientWidth: cell.clientWidth,
            });
          });
        });

        return cellResults;
      }, TABLE_SENTINEL);

      expect(
        results.length,
        "at least one table cell must be present in the DOM for the fixture table",
      ).toBeGreaterThan(0);

      for (const r of results) {
        expect(
          r.overflows,
          `Table[${r.tableIndex}] cell[${r.cellIndex}] overflows at ${vp.width}px: ` +
            `scrollWidth=${r.scrollWidth}, clientWidth=${r.clientWidth}`,
        ).toBe(false);
      }
    });

    /* ── Test 5: all bullet nesting levels do not overflow ──────────────── */
    test("all bullet nesting levels (0 / 16 / 32 px) do not overflow", async ({ page }) => {
      /* AINarrativeRenderer renders bullets as flex rows with
         marginLeft = nestLevel * 16 px (0, 16, or 32).  We find all
         bullet flex rows by looking for direct children of the narrative
         renderer root that have display:flex and a bullet symbol child. */
      const results = await page.evaluate(() => {
        const bulletSymbols = ["•", "◦", "▪"];

        /* Collect all elements whose direct text-node children contain a
           bullet symbol — these are the bullet text spans. */
        const allEls = Array.from(document.querySelectorAll("*"));
        const bulletEls = allEls.filter((el) =>
          Array.from(el.childNodes).some(
            (n) =>
              n.nodeType === Node.TEXT_NODE &&
              bulletSymbols.some((sym) => n.textContent?.includes(sym)),
          ),
        );

        return bulletEls.map((el, i) => {
          /* Walk up to the nearest flex ancestor (the bullet row div). */
          let node: Element | null = el;
          while (node && window.getComputedStyle(node).display !== "flex") {
            node = node.parentElement;
          }
          const target = node ?? el;
          const style = window.getComputedStyle(target);
          return {
            index: i,
            overflows: target.scrollWidth > target.clientWidth,
            scrollWidth: target.scrollWidth,
            clientWidth: target.clientWidth,
            marginLeft: style.marginLeft,
          };
        });
      });

      expect(
        results.length,
        "at least one bullet row must be present in the DOM",
      ).toBeGreaterThan(0);

      for (const r of results) {
        expect(
          r.overflows,
          `Bullet row[${r.index}] (marginLeft=${r.marginLeft}) overflows at ${vp.width}px: ` +
            `scrollWidth=${r.scrollWidth}, clientWidth=${r.clientWidth}`,
        ).toBe(false);
      }
    });

    /* ── Test 6: page body has no horizontal scrollbar ──────────────────── */
    test("page body does not acquire a horizontal scrollbar", async ({ page }) => {
      const result = await page.evaluate(() => ({
        overflows:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
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
