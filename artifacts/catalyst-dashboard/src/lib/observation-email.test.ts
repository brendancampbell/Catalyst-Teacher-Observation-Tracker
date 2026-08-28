// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildEmailHtml, buildEmailPlainText, defaultIntro, type EmailSource } from "@/lib/observation-email";

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
    expect(buildEmailPlainText(src(), undefined, "all").mailtoUrl).toContain("meg%40school.edu");
  });

  it("carries the glows and grows", () => {
    const html = buildEmailHtml(src(), "intro", "Clear directions", "Tighten the do-now", "all");
    expect(html).toContain("Clear directions");
    expect(html).toContain("Tighten the do-now");
  });

  describe("action steps", () => {
    /* A re-sent email describes what THAT observation did, not where things
       stand today — the point of sending it is to reproduce the feedback. */
    it("names a step the observation assigned", () => {
      const html = buildEmailHtml(
        src({ steps: { assigned: { text: "Cold call more widely", dueDate: "2026-09-01" } } }),
        "i", "g", "r", "all");
      expect(html).toContain("Cold call more widely");
    });

    it("names a step the observation marked mastered", () => {
      const html = buildEmailHtml(
        src({ steps: { mastered: { text: "Tighten the do-now", masteredByName: "Ada Coach" } } }),
        "i", "g", "r", "all");
      expect(html).toContain("Tighten the do-now");
    });

    it("says nothing about action steps when there were none", () => {
      const html = buildEmailHtml(src(), "i", "g", "r", "all");
      expect(html).not.toContain("Action Step");
    });
  });

  describe("what the observer chose to include", () => {
    it("leaves the rubric out entirely on glows-only", () => {
      expect(buildEmailPlainText(src(), "i", "glows").body).not.toContain("RUBRIC SCORES");
    });

    it("includes it otherwise", () => {
      expect(buildEmailPlainText(src(), "i", "all").body).toContain("RUBRIC SCORES");
    });

    it("drops unscored rows on scored-only", () => {
      const two = src({
        categories: [{ id: "c1", label: "Instruction", domains: [
          { id: "d1", label: "Planning" }, { id: "d2", label: "Pacing" },
        ] }] as EmailSource["categories"],
        scores: { d1: 1 },
      });
      const body = buildEmailPlainText(two, "i", "scored").body;
      expect(body).toContain("Planning");
      expect(body).not.toContain("Pacing");
    });
  });

  describe("the trend arrows", () => {
    it("reads New when there is nothing to compare against", () => {
      expect(buildEmailHtml(src(), "i", "g", "r", "all")).toContain("New");
    });

    it("compares against the most recent earlier observation", () => {
      const withHistory = src({
        priorObservations: [{ id: "old", date: "2026-08-01", scores: { d1: 0 } }],
      });
      const html = buildEmailHtml(withHistory, "i", "g", "r", "all");
      expect(html).not.toContain(">New<");
      expect(html).toContain("↑");
    });

    it("ignores observations dated after this one", () => {
      /* A mistyped year must not become the baseline and invert the arrow. */
      const withFuture = src({
        priorObservations: [{ id: "future", date: "2027-01-01", scores: { d1: 0 } }],
      });
      expect(buildEmailHtml(withFuture, "i", "g", "r", "all")).toContain("New");
    });
  });

  it("escapes anything a person typed", () => {
    const nasty = src({ teacher: { name: '<img src=x onerror=alert(1)>', gradeLevel: [] } });
    const html = buildEmailHtml(nasty, "i", "g", "r", "all");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
