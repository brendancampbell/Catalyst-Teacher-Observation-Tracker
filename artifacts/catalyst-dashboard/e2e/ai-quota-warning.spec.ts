import { test, expect } from "@playwright/test";

/**
 * E2E spec: AI quota warning banner and exhaustion modal
 *
 * Verifies the quota warning UX added in Task #471:
 *   1. Low quota (chat.remaining ≤ 3) → amber banner in Data Assistant tab
 *   2. Exhausted quota (remaining = 0) → shadcn Dialog modal with IT support link
 *   3. Banner dismiss → hides banner, sets sessionStorage["ai_quota_banner_dismissed"]
 *   4. Modal dismiss suppresses re-trigger from polling; a fresh 429 re-opens the modal
 *
 * Network strategy
 * ----------------
 * Each test injects a fetch mock via addInitScript() so it wraps window.fetch
 * before any React code runs. The mock intercepts GET /api/ai/usage-status and
 * returns the desired quota state. Test 4 also intercepts POST /api/ai/chats
 * and POST /api/ai/chat/stream.
 *
 * Login: Brendan Campbell (U10, NETWORK_ADMIN) — required for the Data
 * Assistant tab (NETWORK_ADMIN-only) and AI endpoints.
 *
 * Fake session IDs used by this file: 99_993
 * Other specs: 99_995 (error), 99_996 (persistence), 99_997 (fresh-state),
 *              99_998 (copy-button), 99_999 (stop-button)
 */

const LOGIN_EMPLOYEE_ID = "U10";
const FAKE_SESSION_ID   = 99_993;

/* Low quota: chat.remaining = 2 (≤ 3 threshold), gen.remaining = 5 (> 3).
   isLow = true (chatRemaining ≤ 3 && both > 0), isExhausted = false. */
const LOW_STATUS = {
  chat:       { remaining: 2, windowRemaining: 20, hasGrant: false },
  generation: { remaining: 5, windowRemaining: 10, hasGrant: false },
};

/* Exhausted: both remaining = 0.
   isExhausted = true (chatRemaining === 0), isLow = false (chatRemaining > 0 check fails). */
const EXHAUSTED_STATUS = {
  chat:       { remaining: 0, windowRemaining: 0, hasGrant: false },
  generation: { remaining: 0, windowRemaining: 0, hasGrant: false },
};

test.describe("AI quota warning banner and exhaustion modal", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /* ─────────────────────────────────────────────────────────────────────
   * Test 1: Low quota → amber banner appears in the Data Assistant tab
   * ───────────────────────────────────────────────────────────────────── */
  test("amber banner appears in Data Assistant tab when quota is low", async ({ page }) => {
    /* 1. Inject fetch mock before page load */
    await page.addInitScript(
      ({ status }: { status: { chat: { remaining: number; windowRemaining: number; hasGrant: boolean }; generation: { remaining: number; windowRemaining: number; hasGrant: boolean } } }) => {
        const orig = window.fetch.bind(window);
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : (input as Request).url;
          if (url.includes("/api/ai/usage-status")) {
            return new Response(JSON.stringify(status), {
              status:  200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return orig(input, init);
        };
      },
      { status: LOW_STATUS },
    );

    /* 2. Login */
    const loginResp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: LOGIN_EMPLOYEE_ID },
    });
    expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();
    expect((await loginResp.json()).ok, "dev-login body.ok must be true").toBe(true);

    /* 3. Navigate */
    await page.goto("/action-center");
    await page.waitForLoadState("networkidle");

    /* 4. Open the Data Assistant tab (the banner renders inside this tab) */
    const assistantTab = page.getByRole("tab", { name: /Data Assistant/i });
    await expect(assistantTab).toBeVisible({ timeout: 10_000 });
    await assistantTab.click();

    /* 5. Amber warning banner must appear with low-quota text */
    await expect(
      page.getByText(/running low on AI tokens/i),
      "Amber banner must appear in Data Assistant tab when chat.remaining ≤ 3",
    ).toBeVisible({ timeout: 10_000 });

    /* 6. Banner dismiss button must be present and accessible */
    await expect(
      page.locator('button[aria-label="Dismiss"]'),
      "Banner must include an accessible Dismiss icon-button",
    ).toBeVisible();

    /* 7. Exhaustion modal must NOT be visible (low ≠ exhausted) */
    /*    Wait for banner to confirm quota resolved first, then check modal absent */
    await expect(
      page.getByRole("heading", { name: /AI Tokens Exhausted/i }),
      "Exhaustion modal must not appear when quota is low (>0) but not exhausted",
    ).not.toBeVisible({ timeout: 2_000 });
  });

  /* ─────────────────────────────────────────────────────────────────────
   * Test 2: Exhausted quota → Dialog modal with IT support link + Dismiss
   * ───────────────────────────────────────────────────────────────────── */
  test("exhaustion Dialog modal appears with correct content when quota hits zero", async ({ page }) => {
    /* 1. Inject fetch mock */
    await page.addInitScript(
      ({ status }: { status: { chat: { remaining: number; windowRemaining: number; hasGrant: boolean }; generation: { remaining: number; windowRemaining: number; hasGrant: boolean } } }) => {
        const orig = window.fetch.bind(window);
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : (input as Request).url;
          if (url.includes("/api/ai/usage-status")) {
            return new Response(JSON.stringify(status), {
              status:  200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return orig(input, init);
        };
      },
      { status: EXHAUSTED_STATUS },
    );

    /* 2. Login and navigate */
    const loginResp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: LOGIN_EMPLOYEE_ID },
    });
    expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();

    await page.goto("/action-center");
    await page.waitForLoadState("networkidle");

    /* 3. Modal must appear automatically — the Dialog renders outside tab content
          so it shows as soon as the quota-status query resolves to 0. */
    await expect(
      page.getByRole("heading", { name: /AI Tokens Exhausted/i }),
      "Exhaustion Dialog title must be visible when quota.remaining = 0",
    ).toBeVisible({ timeout: 10_000 });

    /* 4. IT support mailto link must be present */
    await expect(
      page.getByRole("link", { name: /Email IT Support/i }),
      "Modal must contain the IT support mailto link",
    ).toBeVisible();

    /* 5. Dismiss button must be present inside the dialog */
    await expect(
      page.getByRole("dialog").getByRole("button", { name: /^Dismiss$/i }),
      "Modal must have a Dismiss button",
    ).toBeVisible();

    /* 6. Low-quota banner must NOT be visible
          (banner condition: isLow && !isExhausted — both false when remaining = 0) */
    await expect(
      page.getByText(/running low on AI tokens/i),
      "Low-quota banner must not appear when quota is fully exhausted",
    ).not.toBeVisible({ timeout: 2_000 });
  });

  /* ─────────────────────────────────────────────────────────────────────
   * Test 3: Banner dismiss → hides banner; sessionStorage flag set
   * ───────────────────────────────────────────────────────────────────── */
  test("dismissing the banner hides it and sets the sessionStorage persistence flag", async ({ page }) => {
    /* 1. Inject fetch mock */
    await page.addInitScript(
      ({ status }: { status: { chat: { remaining: number; windowRemaining: number; hasGrant: boolean }; generation: { remaining: number; windowRemaining: number; hasGrant: boolean } } }) => {
        const orig = window.fetch.bind(window);
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : (input as Request).url;
          if (url.includes("/api/ai/usage-status")) {
            return new Response(JSON.stringify(status), {
              status:  200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return orig(input, init);
        };
      },
      { status: LOW_STATUS },
    );

    /* 2. Login and navigate */
    const loginResp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: LOGIN_EMPLOYEE_ID },
    });
    expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();

    await page.goto("/action-center");
    await page.waitForLoadState("networkidle");

    /* 3. Open Data Assistant tab and wait for banner */
    const assistantTab = page.getByRole("tab", { name: /Data Assistant/i });
    await expect(assistantTab).toBeVisible({ timeout: 10_000 });
    await assistantTab.click();

    await expect(
      page.getByText(/running low on AI tokens/i),
    ).toBeVisible({ timeout: 10_000 });

    /* 4. Click the banner's Dismiss icon-button */
    await page.locator('button[aria-label="Dismiss"]').click();

    /* 5. Banner must disappear immediately */
    await expect(
      page.getByText(/running low on AI tokens/i),
      "Banner must hide after Dismiss is clicked",
    ).not.toBeVisible({ timeout: 5_000 });

    /* 6. sessionStorage flag must be set — dismissal persists within the session */
    const flagValue = await page.evaluate(() =>
      sessionStorage.getItem("ai_quota_banner_dismissed"),
    );
    expect(
      flagValue,
      "sessionStorage[\"ai_quota_banner_dismissed\"] must equal \"true\" after dismiss",
    ).toBe("true");
  });

  /* ─────────────────────────────────────────────────────────────────────
   * Test 4: Modal dismiss suppresses poll re-trigger; fresh 429 re-opens
   * ───────────────────────────────────────────────────────────────────── */
  test("modal dismiss suppresses polling re-trigger; a fresh 429 re-opens the modal", async ({ page }) => {
    /*
     * The action-center component's exhaustionSuppressedRef prevents the poll-
     * based useEffect from re-showing the modal after it has been dismissed.
     * However, handleQuotaExhausted() (called by the global 429 handler)
     * explicitly resets exhaustionSuppressedRef.current = false before calling
     * setShowExhaustionModal(true), so a new 429 always overrides the suppression.
     *
     * Test flow:
     *   a. Page loads with exhausted quota → modal appears from polling
     *   b. User dismisses the modal → exhaustionSuppressedRef.current = true
     *   c. User opens Data Assistant tab and sends a chat message
     *   d. POST /api/ai/chat/stream → 429 → apiFetch calls _quotaExhaustedHandler
     *      → handleQuotaExhausted() resets suppression → setShowExhaustionModal(true)
     *   e. Modal re-appears
     */
    const now         = new Date().toISOString();
    const fakeSession = {
      id:        FAKE_SESSION_ID,
      title:     "Test 429 Quota",
      createdAt: now,
      updatedAt: now,
    };

    await page.addInitScript(
      ({
        status,
        session,
      }: {
        status:  { chat: { remaining: number; windowRemaining: number; hasGrant: boolean }; generation: { remaining: number; windowRemaining: number; hasGrant: boolean } };
        session: { id: number; title: string; createdAt: string; updatedAt: string };
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

          /* GET /api/ai/usage-status → exhausted (triggers modal on load) */
          if (url.includes("/api/ai/usage-status") && method === "GET") {
            return new Response(JSON.stringify(status), {
              status:  200,
              headers: { "Content-Type": "application/json" },
            });
          }

          /* POST /api/ai/chats → fake session so createChatSession() succeeds.
             handleSendChat() creates the session before streaming, so this must
             return a valid session object to allow activeChatId to be set. */
          if (
            url.includes("/api/ai/chats") &&
            method === "POST" &&
            !url.includes("/messages") &&
            !url.includes("/stream")
          ) {
            return new Response(JSON.stringify(session), {
              status:  200,
              headers: { "Content-Type": "application/json" },
            });
          }

          /* POST /api/ai/chat/stream → 429.
             streamAIChat() calls apiFetch(), which detects 429, calls
             _quotaExhaustedHandler() (→ handleQuotaExhausted → modal opens),
             then throws HttpError(429). handleSendChat's catch block sees the
             HttpError and returns early (no inline chat error shown). */
          if (url.includes("/api/ai/chat/stream") && method === "POST") {
            return new Response(
              JSON.stringify({ error: "Rate limit exceeded" }),
              { status: 429, headers: { "Content-Type": "application/json" } },
            );
          }

          return orig(input, init);
        };
      },
      { status: EXHAUSTED_STATUS, session: fakeSession },
    );

    /* Login and navigate */
    const loginResp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: LOGIN_EMPLOYEE_ID },
    });
    expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();

    await page.goto("/action-center");
    await page.waitForLoadState("networkidle");

    /* a. Modal must appear automatically from quota polling */
    await expect(
      page.getByRole("heading", { name: /AI Tokens Exhausted/i }),
      "Exhaustion modal must appear on load when quota is 0",
    ).toBeVisible({ timeout: 10_000 });

    /* b. Dismiss the modal */
    await page.getByRole("dialog").getByRole("button", { name: /^Dismiss$/i }).click();

    await expect(
      page.getByRole("heading", { name: /AI Tokens Exhausted/i }),
      "Modal must close after clicking Dismiss",
    ).not.toBeVisible({ timeout: 5_000 });

    /* c. Open Data Assistant tab */
    const assistantTab = page.getByRole("tab", { name: /Data Assistant/i });
    await expect(assistantTab).toBeVisible({ timeout: 8_000 });
    await assistantTab.click();

    /* d. Fill the empty-state textarea and send a message → triggers 429 */
    const initialTextarea = page.locator(
      'textarea[placeholder="Ask about your school\'s observation data…"]',
    );
    await expect(initialTextarea, "Initial empty-state textarea must be visible").toBeVisible({
      timeout: 8_000,
    });
    await initialTextarea.fill("Tell me about teacher performance");
    await initialTextarea.press("Enter");

    /* e. 429 → handleQuotaExhausted → setShowExhaustionModal(true) → modal re-appears */
    await expect(
      page.getByRole("heading", { name: /AI Tokens Exhausted/i }),
      "Exhaustion modal must re-open when a fresh 429 fires after dismissal (suppression overridden)",
    ).toBeVisible({ timeout: 10_000 });
  });
});
