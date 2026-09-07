/**
 * The teacher profile's top summary can be read three ways over the same
 * history — rubric average, most recent, walkthroughs only — and every number
 * above Observation History is computed from whichever subset this returns.
 * Get the subset wrong and the cards lie quietly, so it is tested on its own
 * rather than through the screen.
 */
import { describe, it, expect } from "vitest";
import { observationsForSummaryView, SUMMARY_VIEWS } from "@/components/TeacherScoreOverlay";
import type { Observation } from "@workspace/api-types";

const obs = (date: string, isWalkthrough?: boolean) =>
  ({ id: date, date, scores: {}, observer: "Someone", isWalkthrough }) as unknown as Observation;

/* Newest first, the order the profile has already sorted them into. */
const history = [
  obs("2026-09-01", true),
  obs("2026-08-20"),
  obs("2026-08-01", true),
  obs("2026-07-15", false),
];

describe("observations for a summary view", () => {
  it("gives the rubric average every observation", () => {
    expect(observationsForSummaryView(history, "rubric")).toEqual(history);
  });

  it("narrows 'most recent' to the single newest observation", () => {
    const result = observationsForSummaryView(history, "recent");
    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-09-01");
  });

  it("keeps only walkthroughs, newest first", () => {
    const result = observationsForSummaryView(history, "walkthrough");
    expect(result.map((o) => o.date)).toEqual(["2026-09-01", "2026-08-01"]);
  });

  /* isWalkthrough is optional on the wire, and an observation recorded before
     the flag existed arrives with it absent. Absent means "full observation",
     not "unknown" — treating it as a walkthrough would inflate the count for
     every teacher with older history. */
  it("treats a missing walkthrough flag as a full observation", () => {
    expect(observationsForSummaryView([obs("2026-08-20")], "walkthrough")).toEqual([]);
  });

  it("returns nothing rather than falling back when a teacher has no walkthroughs", () => {
    const noWalkthroughs = [obs("2026-08-20"), obs("2026-07-15", false)];
    expect(observationsForSummaryView(noWalkthroughs, "walkthrough")).toEqual([]);
  });

  it("copes with a teacher who has never been observed", () => {
    for (const v of SUMMARY_VIEWS) {
      expect(observationsForSummaryView([], v.id)).toEqual([]);
    }
  });

  /* The switch must not reorder or mutate the history it was handed — the
     Observation History list below reads from the same array. */
  it("leaves the source history untouched", () => {
    const source = [...history];
    observationsForSummaryView(source, "walkthrough");
    observationsForSummaryView(source, "recent");
    expect(source).toEqual(history);
  });
});
