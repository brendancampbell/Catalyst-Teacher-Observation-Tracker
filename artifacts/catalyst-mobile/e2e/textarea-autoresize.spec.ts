/**
 * textarea-autoresize.spec.ts
 *
 * Confirms the Strengths, Growth Areas, and Action Step textareas auto-expand
 * to show their full content after a draft is restored — from localStorage OR
 * from the API (/api/observations/drafts).
 *
 * Two restore paths are exercised
 * --------------------------------
 * 1. localStorage path — draft written to localStorage by the React auto-save
 *    effect (synchronous, line 363 of observation.tsx). Any stale API drafts
 *    are deleted beforehand so checkForDraft() falls through to localStorage.
 *
 * 2. API path — a draft observation is created directly via Playwright's API
 *    request context (no browser Origin header → CSRF middleware passes it
 *    through in development). localStorage draft keys are then cleared so the
 *    form's checkForDraft() uses the API-fetched draft.
 *
 * For each path the test asserts:
 *   a) The textarea value equals the typed text (draft was actually restored).
 *   b) scrollHeight <= clientHeight (no vertical clipping after auto-resize).
 *
 * Notes on the 403 you may see for POST /api/observations from the BROWSER:
 * The Vite dev server runs at http://127.0.0.1:<PORT>, which is not in the
 * API server's CSRF allowedOrigins (only http://localhost:5173 is whitelisted).
 * The browser autosave therefore gets a 403. Playwright's page.request context
 * sends no Origin header, so it bypasses the CSRF check in development.
 *
 * Test data
 * ---------
 * - Observer  : U10 (Brendan Campbell, NETWORK_ADMIN)
 * - School     : id=14, "Camden Prep Copewood MS"
 * - Rubric     : first non-archived set returned by /api/rubric/sets
 *
 * Reference: artifacts/catalyst-mobile/src/pages/observation.tsx
 *   resize effects          : lines 138-157
 *   localStorage draft save : line 363
 *   checkForDraft           : lines 216-251
 */

import { test, expect } from "@playwright/test";

const LOGIN_EMPLOYEE_ID = "U10";
const SCHOOL_LS_KEY = "catalyst-mobile-selected-school";
const RUBRIC_LS_KEY = "catalyst-mobile-selected-rubric";
const TEST_SCHOOL = { id: 14, displayName: "Camden Prep Copewood MS" };

const STRENGTHS_TEXT =
  "Strength line 1 — teacher modeled the skill clearly\n" +
  "Strength line 2 — cold-call technique was consistent\n" +
  "Strength line 3 — wait time exceeded 5 seconds each round\n" +
  "Strength line 4 — transitions were tight and purposeful\n" +
  "Strength line 5 — student engagement was high throughout";

const GROWTH_TEXT =
  "Growth line 1 — CFU questions were too low-order\n" +
  "Growth line 2 — exit ticket had no success criteria\n" +
  "Growth line 3 — teacher talked over student responses\n" +
  "Growth line 4 — re-teach moment was missed\n" +
  "Growth line 5 — pacing slowed in the last 10 minutes";

const ACTION_STEP_TEXT =
  "Action step line 1 — craft two higher-order CFU questions per lesson\n" +
  "Action step line 2 — design exit ticket with explicit success criteria\n" +
  "Action step line 3 — practice wait time after student responses\n" +
  "Action step line 4 — identify re-teach trigger during planning\n" +
  "Action step line 5 — build a two-minute buffer into the lesson plan";

/** Seed school + rubric into localStorage so NETWORK_ADMIN can reach the form. */
async function seedLocalStorage(
  page: import("@playwright/test").Page,
  rubric: { id: number; slug: string; name: string },
) {
  await page.evaluate(
    ([schoolKey, schoolData, rubricKey, rubricData]) => {
      localStorage.setItem(schoolKey as string, JSON.stringify(schoolData));
      localStorage.setItem(rubricKey as string, JSON.stringify(rubricData));
    },
    [SCHOOL_LS_KEY, TEST_SCHOOL, RUBRIC_LS_KEY, rubric] as const,
  );
}

/** Remove all localStorage keys that look like mobile draft keys. */
async function clearLocalDraftKeys(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("catalyst-mobile-draft-")) localStorage.removeItem(k);
    }
  });
}

/** Delete every API draft visible to the current user (best-effort cleanup). */
async function deleteAllApiDrafts(page: import("@playwright/test").Page) {
  const resp = await page.request.get("/api/observations/drafts");
  if (!resp.ok()) return;
  const drafts: Array<{ id: string }> = await resp.json();
  for (const d of drafts) {
    await page.request.delete(`/api/observations/${d.id}`).catch(() => null);
  }
}

/** Returns {scrollHeight, clientHeight, clipped} for a textarea locator. */
async function textareaMetrics(el: import("@playwright/test").Locator) {
  return el.evaluate((node: HTMLTextAreaElement) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    clipped: node.scrollHeight > node.clientHeight,
  }));
}

test.describe("Textarea auto-resize on draft restore", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let rubric: { id: number; slug: string; name: string };

  test.beforeEach(async ({ page }) => {
    const loginResp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: LOGIN_EMPLOYEE_ID },
    });
    expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();
    const loginBody = await loginResp.json();
    expect(loginBody.ok, "dev-login body.ok must be true").toBe(true);

    const rubricsResp = await page.request.get("/api/rubric/sets");
    expect(rubricsResp.ok(), "rubric sets fetch must succeed").toBeTruthy();
    const rubricSets: Array<{ id: number; slug: string; name: string; isArchived?: boolean }> =
      await rubricsResp.json();
    rubric = rubricSets.find((r) => !r.isArchived) ?? rubricSets[0];
    expect(rubric, "at least one rubric set must exist").toBeTruthy();

    await page.goto("/catalyst-mobile/");
    await seedLocalStorage(page, rubric);
    await page.goto("/catalyst-mobile/observation");
    await expect(page.locator("#obs-form")).toBeVisible({ timeout: 20_000 });
  });

  // ── Test 1: pre-save baseline (typing path) ──────────────────────────────
  test("textareas are not clipped while typing (pre-save baseline)", async ({ page }) => {
    const strengthsTA = page.getByPlaceholder("What is this teacher doing well?");
    const growthAreasTA = page.getByPlaceholder("Where should this teacher focus next?");
    const actionStepTA = page.getByPlaceholder("Describe the action step for this teacher…");

    await expect(strengthsTA).toBeVisible({ timeout: 10_000 });
    await expect(growthAreasTA).toBeVisible({ timeout: 10_000 });
    await expect(actionStepTA).toBeVisible({ timeout: 10_000 });

    await strengthsTA.fill(STRENGTHS_TEXT);
    await growthAreasTA.fill(GROWTH_TEXT);
    await actionStepTA.fill(ACTION_STEP_TEXT);

    // Allow the onChange resize effects to run.
    await page.waitForTimeout(300);

    const sMetrics = await textareaMetrics(strengthsTA);
    const gMetrics = await textareaMetrics(growthAreasTA);
    const aMetrics = await textareaMetrics(actionStepTA);

    expect(
      sMetrics.clipped,
      `Strengths textarea clipped while typing: scrollH=${sMetrics.scrollHeight}, clientH=${sMetrics.clientHeight}`,
    ).toBe(false);
    expect(
      gMetrics.clipped,
      `Growth Areas textarea clipped while typing: scrollH=${gMetrics.scrollHeight}, clientH=${gMetrics.clientHeight}`,
    ).toBe(false);
    expect(
      aMetrics.clipped,
      `Action Step textarea clipped while typing: scrollH=${aMetrics.scrollHeight}, clientH=${aMetrics.clientHeight}`,
    ).toBe(false);
  });

  // ── Test 2: localStorage restore path ────────────────────────────────────
  test("textareas resize correctly after localStorage draft restore", async ({ page }) => {
    const strengthsTA = page.getByPlaceholder("What is this teacher doing well?");
    const growthAreasTA = page.getByPlaceholder("Where should this teacher focus next?");
    const actionStepTA = page.getByPlaceholder("Describe the action step for this teacher…");

    await expect(strengthsTA).toBeVisible({ timeout: 10_000 });
    await expect(growthAreasTA).toBeVisible({ timeout: 10_000 });
    await expect(actionStepTA).toBeVisible({ timeout: 10_000 });

    // Type text. The auto-save useEffect writes to localStorage synchronously
    // (line 363 of observation.tsx) before the 2-second API debounce fires.
    await strengthsTA.fill(STRENGTHS_TEXT);
    await growthAreasTA.fill(GROWTH_TEXT);
    await actionStepTA.fill(ACTION_STEP_TEXT);

    // Let React commit the effect so localStorage is populated.
    await page.waitForTimeout(400);

    // Remove any API drafts so checkForDraft() cannot find one on the return
    // trip and must fall back to localStorage. (Also prevents stale empty
    // drafts from overriding our newly written localStorage data.)
    await deleteAllApiDrafts(page);

    // Navigate away — quickly, before the 2-second API debounce fires.
    await page.goto("/catalyst-mobile/");
    await seedLocalStorage(page, rubric);

    // Navigate back. checkForDraft() → API returns empty → localStorage used.
    await page.goto("/catalyst-mobile/observation");
    await expect(page.locator("#obs-form")).toBeVisible({ timeout: 20_000 });
    await expect(strengthsTA).toBeVisible({ timeout: 10_000 });
    await expect(growthAreasTA).toBeVisible({ timeout: 10_000 });
    await expect(actionStepTA).toBeVisible({ timeout: 10_000 });

    // Allow draft restore + resize effects to settle.
    await page.waitForTimeout(600);

    // 2a) Assert the text was actually restored (not just an empty textarea).
    await expect(strengthsTA).toHaveValue(STRENGTHS_TEXT, { timeout: 5_000 });
    await expect(growthAreasTA).toHaveValue(GROWTH_TEXT, { timeout: 5_000 });
    await expect(actionStepTA).toHaveValue(ACTION_STEP_TEXT, { timeout: 5_000 });

    // 2b) Assert no vertical clipping.
    const sMetrics = await textareaMetrics(strengthsTA);
    const gMetrics = await textareaMetrics(growthAreasTA);
    const aMetrics = await textareaMetrics(actionStepTA);

    expect(
      sMetrics.clipped,
      `Strengths textarea clipped after localStorage restore: scrollH=${sMetrics.scrollHeight}, clientH=${sMetrics.clientHeight}`,
    ).toBe(false);
    expect(
      gMetrics.clipped,
      `Growth Areas textarea clipped after localStorage restore: scrollH=${gMetrics.scrollHeight}, clientH=${gMetrics.clientHeight}`,
    ).toBe(false);
    expect(
      aMetrics.clipped,
      `Action Step textarea clipped after localStorage restore: scrollH=${aMetrics.scrollHeight}, clientH=${aMetrics.clientHeight}`,
    ).toBe(false);
  });

  // ── Test 3: API restore path ─────────────────────────────────────────────
  test("textareas resize correctly after API draft restore", async ({ page }) => {
    // Step 1: discover which teacher the form will auto-select (first active
    // teacher for school 14). We must create the API draft for the same teacher
    // so that checkForDraft() matches on observedEmployeeId.
    const peopleResp = await page.request.get(
      `/api/people?schoolId=${TEST_SCHOOL.id}&includeInFeedbackTracker=true`,
    );
    expect(peopleResp.ok(), "people list must succeed").toBeTruthy();
    const people: Array<{ employeeId: string; isActive: boolean }> = await peopleResp.json();
    const firstActiveTeacher = people.find((p) => p.isActive);
    expect(firstActiveTeacher, "at least one active teacher must exist for school 14").toBeTruthy();
    const teacherEid = firstActiveTeacher!.employeeId;

    const today = new Date().toISOString().split("T")[0]!;

    // Step 2: create a draft observation via Playwright's API request context.
    // page.request sends no Origin header → CSRF middleware passes it through
    // in development (only enforces when isProduction=true or Origin is present).
    // The actionStep field requires both text and dueDate; we pair it with
    // tomorrow's date so the form's condition is satisfied on restore.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split("T")[0]!;
    const createResp = await page.request.post("/api/observations", {
      data: {
        observedEmployeeId: teacherEid,
        rubricSetId: rubric.id,
        date: today,
        strengths: STRENGTHS_TEXT,
        growthAreas: GROWTH_TEXT,
        newActionStep: { text: ACTION_STEP_TEXT, dueDate: tomorrow },
        status: "draft",
      },
    });
    expect(
      createResp.ok(),
      `create API draft: ${createResp.status()} — ${await createResp.text()}`,
    ).toBeTruthy();

    // Step 3: clear localStorage draft keys so checkForDraft() cannot fall
    // back to localStorage and must use the API draft we just created.
    await clearLocalDraftKeys(page);

    // Step 4: navigate away and back, re-seeding school/rubric localStorage.
    await page.goto("/catalyst-mobile/");
    await seedLocalStorage(page, rubric);

    // Step 5: navigate to the observation form. checkForDraft() fires, calls
    // fetchMyDrafts(), finds our draft, and calls loadDraftIntoForm(). The
    // resize useEffects fire on the restored strengths/growthAreas/actionStep state.
    await page.goto("/catalyst-mobile/observation");
    await expect(page.locator("#obs-form")).toBeVisible({ timeout: 20_000 });

    const strengthsTA = page.getByPlaceholder("What is this teacher doing well?");
    const growthAreasTA = page.getByPlaceholder("Where should this teacher focus next?");
    const actionStepTA = page.getByPlaceholder("Describe the action step for this teacher…");

    await expect(strengthsTA).toBeVisible({ timeout: 10_000 });
    await expect(growthAreasTA).toBeVisible({ timeout: 10_000 });
    await expect(actionStepTA).toBeVisible({ timeout: 10_000 });

    // Allow the API draft fetch + state update + resize effects to settle.
    await page.waitForTimeout(1_000);

    // 3a) Assert the text was restored from the API draft.
    await expect(strengthsTA).toHaveValue(STRENGTHS_TEXT, { timeout: 8_000 });
    await expect(growthAreasTA).toHaveValue(GROWTH_TEXT, { timeout: 8_000 });
    await expect(actionStepTA).toHaveValue(ACTION_STEP_TEXT, { timeout: 8_000 });

    // 3b) Assert no vertical clipping.
    const sMetrics = await textareaMetrics(strengthsTA);
    const gMetrics = await textareaMetrics(growthAreasTA);
    const aMetrics = await textareaMetrics(actionStepTA);

    expect(
      sMetrics.clipped,
      `Strengths textarea clipped after API restore: scrollH=${sMetrics.scrollHeight}, clientH=${sMetrics.clientHeight}`,
    ).toBe(false);
    expect(
      gMetrics.clipped,
      `Growth Areas textarea clipped after API restore: scrollH=${gMetrics.scrollHeight}, clientH=${gMetrics.clientHeight}`,
    ).toBe(false);
    expect(
      aMetrics.clipped,
      `Action Step textarea clipped after API restore: scrollH=${aMetrics.scrollHeight}, clientH=${aMetrics.clientHeight}`,
    ).toBe(false);
  });
});
