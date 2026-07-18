/**
 * Unit tests for the "per-domain-latest-across-history" average logic shared
 * by Dashboard (getMostRecentDomainScore → calcOverallAvg) and
 * TeacherProfile (getMostRecentDomainScore → mergedDomainScores →
 * calcOverallAvgFromScores).
 *
 * Tests verify the three edge-cases called out in the task:
 *   1. Fully-scored latest observation → avg matches direct score average
 *   2. Partial latest observation → unscored domains fall back to older obs
 *   3. Deleting the most-recent observation → avg falls back to next obs
 */
import { describe, it, expect } from "vitest";
import { calcOverallAvgFromScores } from "@/lib/utils";

/* ── Types (minimal subset of the real Teacher / Observation types) ────── */

interface Obs {
  id: string;
  date: string;
  scores: Record<string, number>;
}

interface Category {
  id: string;
  domains: Array<{ id: string }>;
}

/* ── Helpers that mirror the production logic ────────────────────────── */

/**
 * Walk observations newest-first, return the first score found for domainId.
 * Mirrors Dashboard.getMostRecentDomainScore and TeacherProfile's inline copy.
 */
function getMostRecentDomainScore(
  observations: Obs[],
  domainId: string,
): number | null {
  const sorted = [...observations].sort((a, b) => b.date.localeCompare(a.date));
  for (const obs of sorted) {
    const score = obs.scores[domainId];
    if (score !== undefined) return score;
  }
  return null;
}

/**
 * Build the merged per-domain scores map that TeacherProfile constructs before
 * calling calcOverallAvgFromScores.
 */
function buildMergedScores(
  observations: Obs[],
  categories: Category[],
): Record<string, number | undefined> {
  const merged: Record<string, number | undefined> = {};
  for (const cat of categories) {
    for (const domain of cat.domains) {
      const score = getMostRecentDomainScore(observations, domain.id);
      if (score !== null) merged[domain.id] = score;
    }
  }
  return merged;
}

/* ── Test fixtures ───────────────────────────────────────────────────── */

const CATS_1: Category[] = [
  { id: "cat1", domains: [{ id: "d1" }, { id: "d2" }] },
];

const CATS_2: Category[] = [
  { id: "cat1", domains: [{ id: "d1" }, { id: "d2" }] },
  { id: "cat2", domains: [{ id: "d3" }, { id: "d4" }] },
];

/* ── Tests ───────────────────────────────────────────────────────────── */

describe("calcOverallAvgFromScores — fully-scored latest observation", () => {
  it("returns the category average when all domains are scored in one observation", () => {
    const obs: Obs[] = [
      { id: "o1", date: "2026-07-01", scores: { d1: 3, d2: 4 } },
    ];
    const merged = buildMergedScores(obs, CATS_1);

    expect(merged).toEqual({ d1: 3, d2: 4 });
    const avg = calcOverallAvgFromScores(merged, CATS_1);
    expect(avg).toBeCloseTo(3.5);
  });

  it("matches a direct arithmetic average when all domains are present", () => {
    const obs: Obs[] = [
      { id: "o1", date: "2026-07-01", scores: { d1: 2, d2: 4, d3: 3, d4: 1 } },
    ];
    const merged = buildMergedScores(obs, CATS_2);

    // cat1 avg = (2+4)/2 = 3, cat2 avg = (3+1)/2 = 2, overall = (3+2)/2 = 2.5
    const avg = calcOverallAvgFromScores(merged, CATS_2);
    expect(avg).toBeCloseTo(2.5);
  });
});

describe("calcOverallAvgFromScores — partial latest observation (unscored domains fall back)", () => {
  it("falls back to the older observation for domains not scored in the newest obs", () => {
    const obs: Obs[] = [
      // Newer: only d1 scored
      { id: "o2", date: "2026-07-01", scores: { d1: 4 } },
      // Older: both domains scored
      { id: "o1", date: "2026-06-01", scores: { d1: 2, d2: 3 } },
    ];
    const merged = buildMergedScores(obs, CATS_1);

    // d1 should come from the newer obs (4), d2 from the older obs (3)
    expect(merged.d1).toBe(4);
    expect(merged.d2).toBe(3);

    const avg = calcOverallAvgFromScores(merged, CATS_1);
    // cat1 avg = (4+3)/2 = 3.5 — NOT (4)/1 = 4.0 (which would be wrong)
    expect(avg).toBeCloseTo(3.5);
  });

  it("does NOT produce the same avg as using only the partial observation", () => {
    const obs: Obs[] = [
      { id: "o2", date: "2026-07-01", scores: { d1: 4 } },
      { id: "o1", date: "2026-06-01", scores: { d1: 2, d2: 3 } },
    ];

    const mergedCorrect = buildMergedScores(obs, CATS_1);
    const avgCorrect = calcOverallAvgFromScores(mergedCorrect, CATS_1);

    // What you'd get if you naively scored only the partial latest obs
    const avgPartialOnly = calcOverallAvgFromScores({ d1: 4 }, CATS_1);

    // The merged avg (3.5) differs from the partial-only avg (4.0)
    expect(avgCorrect).not.toBeCloseTo(avgPartialOnly!);
    expect(avgCorrect).toBeCloseTo(3.5);
    expect(avgPartialOnly).toBeCloseTo(4.0);
  });

  it("handles multi-category rubrics where each category has different fallback depths", () => {
    const obs: Obs[] = [
      // Newest: scores cat1 fully but cat2 partially
      { id: "o3", date: "2026-07-01", scores: { d1: 4, d2: 3, d3: 2 } },
      // Older: all four domains scored
      { id: "o1", date: "2026-05-01", scores: { d1: 1, d2: 1, d3: 1, d4: 4 } },
    ];
    const merged = buildMergedScores(obs, CATS_2);

    // d4 should fall back to the older obs
    expect(merged.d4).toBe(4);

    const avg = calcOverallAvgFromScores(merged, CATS_2);
    // cat1 = (4+3)/2 = 3.5, cat2 = (2+4)/2 = 3.0, overall = (3.5+3.0)/2 = 3.25
    expect(avg).toBeCloseTo(3.25);
  });
});

describe("calcOverallAvgFromScores — deleting the most-recent observation", () => {
  it("falls back to the next observation when the newest is removed", () => {
    const obs: Obs[] = [
      { id: "o2", date: "2026-07-01", scores: { d1: 4, d2: 3 } },
      { id: "o1", date: "2026-06-01", scores: { d1: 2, d2: 1 } },
    ];

    const avgBefore = calcOverallAvgFromScores(
      buildMergedScores(obs, CATS_1),
      CATS_1,
    );
    expect(avgBefore).toBeCloseTo(3.5); // (4+3)/2

    // Simulate deletion: remove obs "o2" (the newest)
    const afterDeletion = obs.filter((o) => o.id !== "o2");
    const avgAfter = calcOverallAvgFromScores(
      buildMergedScores(afterDeletion, CATS_1),
      CATS_1,
    );
    expect(avgAfter).toBeCloseTo(1.5); // (2+1)/2
  });

  it("falls back per-domain independently when only the deleted obs had certain domains", () => {
    // Newest obs: scored both domains
    // Older obs: scored only d2
    const obs: Obs[] = [
      { id: "o2", date: "2026-07-01", scores: { d1: 4, d2: 3 } },
      { id: "o1", date: "2026-06-01", scores: { d2: 1 } },
    ];

    const avgBefore = calcOverallAvgFromScores(
      buildMergedScores(obs, CATS_1),
      CATS_1,
    );
    expect(avgBefore).toBeCloseTo(3.5); // (4+3)/2

    // After deleting o2: d1 has no score, d2 falls back to 1
    const afterDeletion = obs.filter((o) => o.id !== "o2");
    const mergedAfter = buildMergedScores(afterDeletion, CATS_1);

    expect(mergedAfter.d1).toBeUndefined(); // d1 has no more scores
    expect(mergedAfter.d2).toBe(1);

    // cat1 avg = (1)/1 = 1 (only d2 is scored)
    const avgAfter = calcOverallAvgFromScores(mergedAfter, CATS_1);
    expect(avgAfter).toBeCloseTo(1.0);
  });

  it("returns null when all observations are deleted", () => {
    const merged = buildMergedScores([], CATS_1);
    const avg = calcOverallAvgFromScores(merged, CATS_1);
    expect(avg).toBeNull();
  });
});

describe("calcOverallAvgFromScores — edge cases", () => {
  it("returns null for an empty categories array", () => {
    expect(calcOverallAvgFromScores({ d1: 3 }, [])).toBeNull();
  });

  it("returns null when no domains are scored", () => {
    expect(calcOverallAvgFromScores({}, CATS_1)).toBeNull();
  });

  it("skips categories with no scored domains rather than counting them as zero", () => {
    // Only cat1 domains scored; cat2 has no scores
    const scores = { d1: 2, d2: 4 };
    const avg = calcOverallAvgFromScores(scores, CATS_2);
    // cat1 avg = 3.0; cat2 skipped → overall = 3.0 (NOT (3.0+0)/2 = 1.5)
    expect(avg).toBeCloseTo(3.0);
  });
});
