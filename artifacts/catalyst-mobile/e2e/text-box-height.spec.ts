/**
 * text-box-height.spec.ts
 *
 * The Strengths, Growth Areas and Action Step boxes are rich-text editors.
 * Each opens about three and a half lines tall, grows with what is written up
 * to five lines, and scrolls beyond that — rather than growing without limit
 * and pushing the rest of the form off the screen.
 *
 * Replaces textarea-autoresize.spec.ts, which checked the opposite: that the
 * old plain textareas grew to show everything. The draft-restore paths it
 * covered are kept, because a restored draft is when a box most often arrives
 * already full.
 *
 * For each path the test asserts:
 *   a) The text was actually restored (first and last line present).
 *   b) The box stopped at the five-line cap and scrolls.
 *
 * Needs the API server and a seeded development database; not run in CI.
 *
 * Test data
 * ---------
 * - Observer  : U10 (NETWORK_ADMIN)
 * - School    : id=14, "Camden Prep Copewood MS"
 * - Rubric    : first non-archived set returned by /api/rubric/sets
 */

import { test, expect, type Locator, type Page } from "@playwright/test";

const LOGIN_EMPLOYEE_ID = "U10";
const SCHOOL_LS_KEY = "catalyst-mobile-selected-school";
const RUBRIC_LS_KEY = "catalyst-mobile-selected-rubric";
const TEST_SCHOOL = { id: 14, displayName: "Camden Prep Copewood MS" };

/* Kept in step with RichTextEditor.tsx: 14px text at line height 1.6, plus
   10px of padding above and below. */
const LINE_PX = 14 * 1.6;
const OPEN_HEIGHT = Math.round(3.5 * LINE_PX + 20);
const MAX_HEIGHT = Math.round(5 * LINE_PX + 20);

const STRENGTHS_LINES = [
  "Strength line 1 — teacher modeled the skill clearly",
  "Strength line 2 — cold-call technique was consistent",
  "Strength line 3 — wait time exceeded 5 seconds each round",
  "Strength line 4 — transitions were tight and purposeful",
  "Strength line 5 — student engagement was high throughout",
  "Strength line 6 — exit ticket data was reviewed on the spot",
];
const GROWTH_LINES = [
  "Growth line 1 — CFU questions were too low-order",
  "Growth line 2 — exit ticket had no success criteria",
  "Growth line 3 — teacher talked over student responses",
  "Growth line 4 — re-teach moment was missed",
  "Growth line 5 — pacing slowed in the last 10 minutes",
  "Growth line 6 — independent practice started late",
];
const ACTION_STEP_LINES = [
  "Action step line 1 — craft two higher-order CFU questions per lesson",
  "Action step line 2 — design exit ticket with explicit success criteria",
  "Action step line 3 — practice wait time after student responses",
  "Action step line 4 — identify re-teach trigger during planning",
  "Action step line 5 — build a two-minute buffer into the lesson plan",
  "Action step line 6 — script the first two minutes of the do-now",
];

const boxes = (page: Page) => ({
  strengths:  page.getByRole("textbox", { name: "Teacher Strengths (Glows)" }),
  growth:     page.getByRole("textbox", { name: "Growth Areas (Grows)" }),
  actionStep: page.getByRole("textbox", { name: "Action Step" }),
});

async function seedLocalStorage(page: Page, rubric: { id: number; slug: string; name: string }) {
  await page.evaluate(
    ([schoolKey, schoolData, rubricKey, rubricData]) => {
      localStorage.setItem(schoolKey as string, JSON.stringify(schoolData));
      localStorage.setItem(rubricKey as string, JSON.stringify(rubricData));
    },
    [SCHOOL_LS_KEY, TEST_SCHOOL, RUBRIC_LS_KEY, rubric] as const,
  );
}

async function clearLocalDraftKeys(page: Page) {
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("catalyst-mobile-draft-")) localStorage.removeItem(k);
    }
  });
}

async function deleteAllApiDrafts(page: Page) {
  const resp = await page.request.get("/api/observations/drafts");
  if (!resp.ok()) return;
  const drafts: Array<{ id: string }> = await resp.json();
  for (const d of drafts) {
    await page.request.delete(`/api/observations/${d.id}`).catch(() => null);
  }
}

/** Types one paragraph per line, as a person pressing Enter would. */
async function typeLines(box: Locator, lines: string[]) {
  await box.click();
  for (const [i, line] of lines.entries()) {
    await box.page().keyboard.insertText(line);
    if (i < lines.length - 1) await box.press("Enter");
  }
}

/** Height of the scrolling area around an editor — the part that is capped. */
async function boxMetrics(box: Locator) {
  return box.evaluate((node) => {
    let el: HTMLElement | null = node as HTMLElement;
    while (el && getComputedStyle(el).overflowY !== "auto") el = el.parentElement;
    if (!el) throw new Error("no scrolling area around the editor");
    return { clientHeight: el.clientHeight, scrollHeight: el.scrollHeight };
  });
}

async function expectCappedAndScrolling(box: Locator, name: string) {
  const m = await boxMetrics(box);
  expect(m.clientHeight, `${name}: taller than five lines (${m.clientHeight}px)`).toBeLessThanOrEqual(MAX_HEIGHT + 1);
  expect(m.clientHeight, `${name}: did not grow to the cap (${m.clientHeight}px)`).toBeGreaterThanOrEqual(MAX_HEIGHT - 1);
  expect(m.scrollHeight, `${name}: six lines should scroll`).toBeGreaterThan(m.clientHeight);
}

async function expectRestored(box: Locator, lines: string[]) {
  await expect(box).toContainText(lines[0]!, { timeout: 8_000 });
  await expect(box).toContainText(lines[lines.length - 1]!, { timeout: 8_000 });
}

test.describe("Rich-text box height", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let rubric: { id: number; slug: string; name: string };

  test.beforeEach(async ({ page }) => {
    const loginResp = await page.request.post("/api/auth/dev-login", {
      data: { employeeId: LOGIN_EMPLOYEE_ID },
    });
    expect(loginResp.ok(), "dev-login must succeed").toBeTruthy();

    const rubricsResp = await page.request.get("/api/rubric/sets");
    expect(rubricsResp.ok(), "rubric sets fetch must succeed").toBeTruthy();
    const rubricSets: Array<{ id: number; slug: string; name: string; isArchived?: boolean }> =
      await rubricsResp.json();
    rubric = rubricSets.find((r) => !r.isArchived) ?? rubricSets[0]!;
    expect(rubric, "at least one rubric set must exist").toBeTruthy();

    await page.goto("/catalyst-mobile/");
    await seedLocalStorage(page, rubric);
    await page.goto("/catalyst-mobile/observation");
    await expect(page.locator("#obs-form")).toBeVisible({ timeout: 20_000 });
  });

  test("empty boxes open at three and a half lines", async ({ page }) => {
    for (const [name, box] of Object.entries(boxes(page))) {
      await expect(box).toBeVisible({ timeout: 10_000 });
      const m = await boxMetrics(box);
      expect(Math.abs(m.clientHeight - OPEN_HEIGHT), `${name}: opened at ${m.clientHeight}px`).toBeLessThanOrEqual(1);
    }
  });

  test("boxes stop at five lines and scroll while typing", async ({ page }) => {
    const b = boxes(page);
    await typeLines(b.strengths, STRENGTHS_LINES);
    await typeLines(b.growth, GROWTH_LINES);
    await typeLines(b.actionStep, ACTION_STEP_LINES);

    await expectCappedAndScrolling(b.strengths, "Strengths");
    await expectCappedAndScrolling(b.growth, "Growth Areas");
    await expectCappedAndScrolling(b.actionStep, "Action Step");
  });

  test("a draft restored from localStorage arrives capped", async ({ page }) => {
    const b = boxes(page);
    await typeLines(b.strengths, STRENGTHS_LINES);
    await typeLines(b.growth, GROWTH_LINES);
    await typeLines(b.actionStep, ACTION_STEP_LINES);
    await page.waitForTimeout(400);

    /* No API draft, so the return trip has to use localStorage. */
    await deleteAllApiDrafts(page);
    await page.goto("/catalyst-mobile/");
    await seedLocalStorage(page, rubric);
    await page.goto("/catalyst-mobile/observation");
    await expect(page.locator("#obs-form")).toBeVisible({ timeout: 20_000 });

    const back = boxes(page);
    await expectRestored(back.strengths, STRENGTHS_LINES);
    await expectRestored(back.growth, GROWTH_LINES);
    await expectRestored(back.actionStep, ACTION_STEP_LINES);

    await expectCappedAndScrolling(back.strengths, "Strengths");
    await expectCappedAndScrolling(back.growth, "Growth Areas");
    await expectCappedAndScrolling(back.actionStep, "Action Step");
  });

  test("a plain-text draft restored from the API keeps its lines and arrives capped", async ({ page }) => {
    /* The draft must be for the teacher the form selects first. */
    const peopleResp = await page.request.get(
      `/api/people?schoolId=${TEST_SCHOOL.id}&includeInFeedbackTracker=true`,
    );
    expect(peopleResp.ok(), "people list must succeed").toBeTruthy();
    const people: Array<{ employeeId: string; isActive: boolean }> = await peopleResp.json();
    const firstActiveTeacher = people.find((p) => p.isActive);
    expect(firstActiveTeacher, "at least one active teacher must exist for school 14").toBeTruthy();

    const today = new Date().toISOString().split("T")[0]!;
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split("T")[0]!;

    /* Plain text with line breaks, as drafts written before the editor are.
       Each line must open as its own paragraph. */
    const createResp = await page.request.post("/api/observations", {
      data: {
        observedEmployeeId: firstActiveTeacher!.employeeId,
        rubricSetId: rubric.id,
        date: today,
        strengths: STRENGTHS_LINES.join("\n"),
        growthAreas: GROWTH_LINES.join("\n"),
        newActionStep: { text: ACTION_STEP_LINES.join("\n"), dueDate: tomorrow },
        status: "draft",
      },
    });
    expect(createResp.ok(), `create API draft: ${createResp.status()} — ${await createResp.text()}`).toBeTruthy();

    await clearLocalDraftKeys(page);
    await page.goto("/catalyst-mobile/");
    await seedLocalStorage(page, rubric);
    await page.goto("/catalyst-mobile/observation");
    await expect(page.locator("#obs-form")).toBeVisible({ timeout: 20_000 });

    const b = boxes(page);
    await expectRestored(b.strengths, STRENGTHS_LINES);
    await expectRestored(b.growth, GROWTH_LINES);
    await expectRestored(b.actionStep, ACTION_STEP_LINES);
    await expect(b.strengths.locator("p")).toHaveCount(STRENGTHS_LINES.length);

    await expectCappedAndScrolling(b.strengths, "Strengths");
    await expectCappedAndScrolling(b.growth, "Growth Areas");
    await expectCappedAndScrolling(b.actionStep, "Action Step");
  });
});
