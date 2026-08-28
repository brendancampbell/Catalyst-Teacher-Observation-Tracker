// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  buildEmailHtml, buildEmailPlainText, defaultIntro,
  applicableSections, defaultSections, normaliseSections,
  type EmailSource, type EmailSections,
} from "@/lib/observation-email";

const ALL: EmailSections = {
  scoredRows: true, unscoredRows: true, glows: true, grows: true, actionSteps: true,
};

const src = (over: Partial<EmailSource> = {}): EmailSource => ({
  teacher: { name: "Meg Salta", firstName: "Meg", email: "meg@school.edu", subject: "Math", gradeLevel: ["9"] },
  date: "2026-08-20",
  time: "09:15",
  course: "Algebra I",
  observerName: "Ada Coach",
  categories: [{ id: "c1", label: "Instruction", domains: [{ id: "d1", label: "Planning" }] }] as EmailSource["categories"],
  scores: { d1: 1 },
  strengths: "Clear directions",
  growthAreas: "Tighten the do-now",
  steps: {},
  priorObservations: [],
  ...over,
});

describe("the feedback email", () => {
  it("addresses the teacher by first name", () => {
    expect(defaultIntro("Meg", "Ada Coach")).toContain("Dear Meg,");
    expect(defaultIntro("Meg", "Ada Coach")).toContain("Ada Coach");
  });

  it("addresses it to the teacher", () => {
    expect(buildEmailPlainText(src(), undefined, ALL).mailtoUrl).toContain("meg%40school.edu");
  });

  it("carries the glows and grows", () => {
    const html = buildEmailHtml(src(), "intro", "Clear directions", "Tighten the do-now", ALL);
    expect(html).toContain("Clear directions");
    expect(html).toContain("Tighten the do-now");
  });

  describe("action steps", () => {
    /* A re-sent email describes what THAT observation did, not where things
       stand today — the point of sending it is to reproduce the feedback. */
    it("names a step the observation assigned", () => {
      const html = buildEmailHtml(
        src({ steps: { assigned: { text: "Cold call more widely", dueDate: "2026-09-01" } } }),
        "i", "g", "r", ALL);
      expect(html).toContain("Cold call more widely");
    });

    it("names a step the observation marked mastered", () => {
      const html = buildEmailHtml(
        src({ steps: { mastered: { text: "Tighten the do-now", masteredByName: "Ada Coach" } } }),
        "i", "g", "r", ALL);
      expect(html).toContain("Tighten the do-now");
    });

    it("says nothing about action steps when there were none", () => {
      const html = buildEmailHtml(src(), "i", "g", "r", ALL);
      expect(html).not.toContain("Action Step");
    });
  });

  describe("the five things the observer can include", () => {
    const twoDomains = () => src({
      categories: [{ id: "c1", label: "Instruction", domains: [
        { id: "d1", label: "Planning" }, { id: "d2", label: "Pacing" },
      ] }] as EmailSource["categories"],
      scores: { d1: 1 },
    });
    const only = (over: Partial<EmailSections>): EmailSections =>
      ({ scoredRows: false, unscoredRows: false, glows: false, grows: false, actionSteps: false, ...over });

    it("keeps scored rows and drops unscored ones", () => {
      const body = buildEmailPlainText(twoDomains(), "i", only({ scoredRows: true })).body;
      expect(body).toContain("Planning");
      expect(body).not.toContain("Pacing");
    });

    it("will not send the unscored rows on their own", () => {
      /* A rubric table of only the rows nobody scored is a list of what the
         observer did not look at. The rule is enforced in the builder, not
         just greyed out in the panel, so it holds however this is called. */
      const body = buildEmailPlainText(twoDomains(), "i", only({ unscoredRows: true })).body;
      expect(body).not.toContain("RUBRIC SCORES");
      expect(body).not.toContain("Pacing");
    });

    it("sends both together when both are wanted", () => {
      const body = buildEmailPlainText(twoDomains(), "i", only({ scoredRows: true, unscoredRows: true })).body;
      expect(body).toContain("Planning");
      expect(body).toContain("Pacing");
    });

    it("normalises rather than clears, so the sub-choice survives", () => {
      const kept = normaliseSections({ scoredRows: false, unscoredRows: true, glows: true, grows: true, actionSteps: true });
      expect(kept.unscoredRows).toBe(false);
      const back = normaliseSections({ scoredRows: true, unscoredRows: true, glows: true, grows: true, actionSteps: true });
      expect(back.unscoredRows).toBe(true);
    });

    it("leaves the rubric out when neither is wanted", () => {
      expect(buildEmailPlainText(src(), "i", only({ glows: true })).body).not.toContain("RUBRIC SCORES");
    });

    it("holds back the average when the scored rows are not shown", () => {
      /* An average of rows the reader cannot see explains nothing. */
      const body = buildEmailPlainText(twoDomains(), "i", only({ unscoredRows: true })).body;
      expect(body).not.toContain("Overall Average");
    });

    it("drops glows and grows independently", () => {
      const noGlows = buildEmailPlainText(src(), "i", only({ grows: true })).body;
      expect(noGlows).not.toContain("GLOWS");
      expect(noGlows).toContain("GROWS");

      const noGrows = buildEmailPlainText(src(), "i", only({ glows: true })).body;
      expect(noGrows).toContain("GLOWS");
      expect(noGrows).not.toContain("GROWS");
    });

    it("drops the action step when it is not wanted", () => {
      const withStep = src({ steps: { assigned: { text: "Cold call more widely", dueDate: "2026-09-01" } } });
      expect(buildEmailHtml(withStep, "i", "g", "r", ALL)).toContain("Cold call more widely");
      expect(buildEmailHtml(withStep, "i", "g", "r", only({ glows: true }))).not.toContain("Cold call more widely");
    });
  });

  describe("which lines are offered at all", () => {
    it("offers everything when everything is there", () => {
      const full = src({ steps: { assigned: { text: "step", dueDate: "2026-09-01" } } });
      expect(defaultSections(full)).toEqual({
        scoredRows: true, unscoredRows: false, glows: true, grows: true, actionSteps: true,
      });
    });

    it("does not offer action steps when there are none", () => {
      expect(applicableSections(src()).actionSteps).toBe(false);
    });

    it("does not offer glows when nothing was written", () => {
      /* Tiptap leaves "<p></p>" behind for an untouched editor, which is not
         writing and must not read as it. */
      expect(applicableSections(src({ strengths: "<p></p>" })).glows).toBe(false);
      expect(applicableSections(src({ strengths: "  " })).glows).toBe(false);
    });

    it("does not offer unscored rows when every row is scored", () => {
      expect(applicableSections(src()).unscoredRows).toBe(false);
    });

    it("does not offer scored rows when nothing was scored", () => {
      expect(applicableSections(src({ scores: {} })).scoredRows).toBe(false);
    });
  });

  describe("the trend arrows", () => {
    it("reads New when there is nothing to compare against", () => {
      expect(buildEmailHtml(src(), "i", "g", "r", ALL)).toContain("New");
    });

    it("compares against the most recent earlier observation", () => {
      const withHistory = src({
        priorObservations: [{ id: "old", date: "2026-08-01", scores: { d1: 0 } }],
      });
      const html = buildEmailHtml(withHistory, "i", "g", "r", ALL);
      expect(html).not.toContain(">New<");
      expect(html).toContain("↑");
    });

    it("ignores observations dated after this one", () => {
      /* A mistyped year must not become the baseline and invert the arrow. */
      const withFuture = src({
        priorObservations: [{ id: "future", date: "2027-01-01", scores: { d1: 0 } }],
      });
      expect(buildEmailHtml(withFuture, "i", "g", "r", ALL)).toContain("New");
    });
  });

  it("escapes anything a person typed", () => {
    const nasty = src({ teacher: { name: '<img src=x onerror=alert(1)>', gradeLevel: [] } });
    const html = buildEmailHtml(nasty, "i", "g", "r", ALL);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
