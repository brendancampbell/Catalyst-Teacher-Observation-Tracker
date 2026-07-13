import { describe, it, expect } from "vitest";
import { getScoreColor, getScoreTextColor, getScoreColorExact } from "./ScoreCell";
import { calcOverallAvgFromScores } from "@/lib/utils";

/* ── ScoreCell color helpers with 0.0 input ──────────────────────────────── */

describe("getScoreColor with 0.0", () => {
  it("returns the red class for a 0.0 score", () => {
    expect(getScoreColor(0)).toContain("bg-red");
  });

  it("does not return null or empty for a 0.0 score", () => {
    expect(getScoreColor(0)).toBeTruthy();
  });
});

describe("getScoreTextColor with 0.0", () => {
  it("returns a non-empty color string for 0.0", () => {
    const color = getScoreTextColor(0);
    expect(color).toBeTruthy();
    expect(typeof color).toBe("string");
  });
});

describe("getScoreColorExact with 0.0", () => {
  it("returns the red class for a 0.0 score", () => {
    expect(getScoreColorExact(0)).toContain("bg-red");
  });
});

/* ── calcOverallAvgFromScores with 0.0 domain scores ─────────────────────
 * This is the shared, exported utility that Dashboard.tsx and
 * DistrictDashboard.tsx both use for overall average computation.
 * A 0.0 score must propagate as 0 (not null).
 * ─────────────────────────────────────────────────────────────────────────── */

const ONE_CATEGORY = [{ id: "cat1", domains: [{ id: "d1" }, { id: "d2" }] }];
const TWO_CATEGORIES = [
  { id: "cat1", domains: [{ id: "d1" }, { id: "d2" }] },
  { id: "cat2", domains: [{ id: "d3" }] },
];

describe("calcOverallAvgFromScores with 0.0 scores", () => {
  it("returns 0 (not null) when all domain scores are 0.0", () => {
    const scores = { d1: 0, d2: 0 };
    const result = calcOverallAvgFromScores(scores, ONE_CATEGORY);
    expect(result).not.toBeNull();
    expect(result).toBe(0);
  });

  it("returns 0 across multiple categories when all scores are 0.0", () => {
    const scores = { d1: 0, d2: 0, d3: 0 };
    const result = calcOverallAvgFromScores(scores, TWO_CATEGORIES);
    expect(result).not.toBeNull();
    expect(result).toBe(0);
  });

  it("correctly mixes a 0.0 domain score with non-zero scores", () => {
    const scores = { d1: 0, d2: 1.0 };
    const result = calcOverallAvgFromScores(scores, ONE_CATEGORY);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(0.5);
  });

  it("still returns null when scores are truly absent (undefined)", () => {
    const result = calcOverallAvgFromScores({}, ONE_CATEGORY);
    expect(result).toBeNull();
  });
});
