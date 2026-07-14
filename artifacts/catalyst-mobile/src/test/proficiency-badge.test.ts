/**
 * Mobile proficiency-badge label parity tests
 *
 * Verifies that any proficiency-level label surfaced in the mobile app
 * reads "Not Proficient" for below-threshold scores and never falls back
 * to the score-option label "Not Yet".
 *
 * These tests lock in the getProficiencyLabel utility that all future
 * mobile badge/label rendering must use, ensuring parity with the
 * Principal Dashboard (catalyst-dashboard).
 *
 * Reference: artifacts/catalyst-dashboard/src/pages/action-center.badge.test.tsx
 */

import { describe, it, expect } from "vitest";
import { getProficiencyLabel, PROFICIENCY_THRESHOLD } from "@/lib/utils";

describe("getProficiencyLabel — mobile proficiency badge parity", () => {
  it("returns 'Not Proficient' when average is below threshold (0.5)", () => {
    expect(getProficiencyLabel(0.5)).toBe("Not Proficient");
  });

  it("returns 'Not Proficient' when average is 0 (all Not Yet scores)", () => {
    expect(getProficiencyLabel(0)).toBe("Not Proficient");
  });

  it("returns 'Not Proficient' when average is just below threshold (0.699)", () => {
    expect(getProficiencyLabel(0.699)).toBe("Not Proficient");
  });

  it("returns 'Proficient' when average equals threshold exactly (0.7)", () => {
    expect(getProficiencyLabel(PROFICIENCY_THRESHOLD)).toBe("Proficient");
  });

  it("returns 'Proficient' when average is above threshold (0.85)", () => {
    expect(getProficiencyLabel(0.85)).toBe("Proficient");
  });

  it("returns 'Proficient' when average is 1.0 (all Proficient scores)", () => {
    expect(getProficiencyLabel(1.0)).toBe("Proficient");
  });

  it("never returns 'Not Yet' for any below-threshold average", () => {
    const belowThresholdValues = [0, 0.1, 0.25, 0.5, 0.65, 0.699];
    for (const avg of belowThresholdValues) {
      expect(getProficiencyLabel(avg)).not.toBe("Not Yet");
    }
  });

  it("never returns 'Not Yet' for any above-threshold average", () => {
    const aboveThresholdValues = [0.7, 0.75, 0.8, 0.9, 1.0];
    for (const avg of aboveThresholdValues) {
      expect(getProficiencyLabel(avg)).not.toBe("Not Yet");
    }
  });
});
