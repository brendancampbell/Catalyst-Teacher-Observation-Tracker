import { describe, it, expect } from "vitest";
import { calcOverallAvgFromScores } from "@/lib/utils";

/*
 * Fixed rubric: 2 categories × 2 domains each
 *
 *   cat1: d1=3.0, d2=1.0  → catAvg = 2.0
 *   cat2: d3=2.0, d4=4.0  → catAvg = 3.0
 *   overall = (2.0 + 3.0) / 2 = 2.5
 */

const CATEGORIES = [
  { id: "cat1", domains: [{ id: "d1" }, { id: "d2" }] },
  { id: "cat2", domains: [{ id: "d3" }, { id: "d4" }] },
];

const DOMAIN_SCORES_UNDEFINED: Record<string, number | undefined> = {
  d1: 3,
  d2: 1,
  d3: 2,
  d4: 4,
};

const DOMAIN_SCORES_NULL: Record<string, number | null> = {
  d1: 3,
  d2: 1,
  d3: 2,
  d4: 4,
};

const EXPECTED = 2.5;

describe("calcOverallAvgFromScores — shared utility", () => {
  it("(a) returns the expected value when called directly", () => {
    expect(calcOverallAvgFromScores(DOMAIN_SCORES_UNDEFINED, CATEGORIES)).toBe(EXPECTED);
  });

  it("(b) Dashboard.tsx single-teacher path agrees — flat scores map built from per-domain scores", () => {
    /*
     * Simulates what calcOverallAvg does for teachers.length === 1:
     * loop categories+domains, call getMostRecentDomainScore (or getQuarterDomainScore),
     * build scores map, delegate to calcOverallAvgFromScores.
     *
     * We replicate the mapping step here with known domain values standing in
     * for what the domain-score helpers would return.
     */
    const scores: Record<string, number | undefined> = {};
    for (const cat of CATEGORIES) {
      for (const d of cat.domains) {
        const rawScore: number | null = DOMAIN_SCORES_NULL[d.id] ?? null;
        scores[d.id] = rawScore ?? undefined;
      }
    }
    expect(calcOverallAvgFromScores(scores, CATEGORIES)).toBe(EXPECTED);
  });

  it("(c) DistrictDashboard.tsx path agrees — null-coerced domain averages via calcOverallAvgFromScores", () => {
    /*
     * Simulates what buildDisplayRows does after removing computeOverall:
     * coerce null → undefined in the domainAverages map, then call
     * calcOverallAvgFromScores.
     */
    const adaptedForOverall: Record<string, number | undefined> = {};
    for (const [k, v] of Object.entries(DOMAIN_SCORES_NULL)) {
      adaptedForOverall[k] = v ?? undefined;
    }
    expect(calcOverallAvgFromScores(adaptedForOverall, CATEGORIES)).toBe(EXPECTED);
  });

  it("all three paths produce the same value for the same underlying data", () => {
    const direct = calcOverallAvgFromScores(DOMAIN_SCORES_UNDEFINED, CATEGORIES);

    const dashboardScores: Record<string, number | undefined> = {};
    for (const cat of CATEGORIES) {
      for (const d of cat.domains) {
        dashboardScores[d.id] = DOMAIN_SCORES_NULL[d.id] ?? undefined;
      }
    }
    const dashboardResult = calcOverallAvgFromScores(dashboardScores, CATEGORIES);

    const districtScores: Record<string, number | undefined> = {};
    for (const [k, v] of Object.entries(DOMAIN_SCORES_NULL)) {
      districtScores[k] = v ?? undefined;
    }
    const districtResult = calcOverallAvgFromScores(districtScores, CATEGORIES);

    expect(direct).toBe(EXPECTED);
    expect(dashboardResult).toBe(direct);
    expect(districtResult).toBe(direct);
  });

  it("returns null when all domain scores are missing", () => {
    expect(calcOverallAvgFromScores({}, CATEGORIES)).toBeNull();
  });

  it("skips categories with no scored domains and averages only the scored ones", () => {
    const partialScores: Record<string, number | undefined> = { d1: 3, d2: 1 };
    expect(calcOverallAvgFromScores(partialScores, CATEGORIES)).toBe(2.0);
  });
});
