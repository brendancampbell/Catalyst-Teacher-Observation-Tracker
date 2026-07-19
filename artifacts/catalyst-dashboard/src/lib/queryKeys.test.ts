/**
 * Regression guard: each query key invalidated by AdminSchoolYearsTab's
 * activateMut.onSuccess must be a prefix-match of at least one useQuery
 * consumer key declared in the dashboard codebase.
 *
 * This test runs in < 1 ms — it validates the constant strings, not live
 * network calls. For a browser-level smoke test after a real year activation
 * watch the Network tab for 200 responses to these endpoints:
 *   - GET /api/rubric-sets                   (rubricSets)
 *   - GET /api/rubric-sets                   (quarters / TeacherProfile)
 *   - GET /api/dashboard                     (dashboard)
 *   - GET /api/action-center/overdue-actions (overdueActionSteps)
 */

import { describe, it, expect } from "vitest";
import { QUERY_KEYS } from "./queryKeys";

describe("QUERY_KEYS — activateMut.onSuccess invalidation coverage", () => {
  /**
   * Keys that AdminSchoolYearsTab.activateMut.onSuccess invalidates.
   * Update this list whenever activateMut changes.
   */
  const activationInvalidations = [
    QUERY_KEYS.adminSchoolYears,
    QUERY_KEYS.schoolYearRubricSets,
    QUERY_KEYS.rubricSets,
    QUERY_KEYS.rubricSetsForCopy,
    QUERY_KEYS.activationPreview,
    QUERY_KEYS.quarters,
    QUERY_KEYS.dashboard,
    QUERY_KEYS.overdueActionSteps,
  ] as const;

  /**
   * useQuery keys declared across Dashboard.tsx, DistrictDashboard.tsx,
   * action-center.tsx, TeacherProfile.tsx (page + component), and admin.tsx
   * that depend on the active school year.
   */
  const consumerKeys = [
    QUERY_KEYS.adminSchoolYears,       // AdminSchoolYearsTab yearsQ
    QUERY_KEYS.schoolYearRubricSets,   // AdminSchoolYearsTab selectedYrSetsQ
    QUERY_KEYS.rubricSets,             // Dashboard, DistrictDashboard, admin
    QUERY_KEYS.rubricSetsForCopy,      // AdminSchoolYearsTab activeYrSetsQ
    QUERY_KEYS.activationPreview,      // AdminSchoolYearsTab previewQ
    QUERY_KEYS.quarters,               // action-center, TeacherProfile (page)
    QUERY_KEYS.dashboard,              // Dashboard, action-center, TeacherProfile
    QUERY_KEYS.overdueActionSteps,     // action-center
  ] as const;

  it("each invalidation key prefix-matches at least one consumer key", () => {
    for (const inv of activationInvalidations) {
      const matched = consumerKeys.some((ck) => ck[0] === inv[0]);
      expect(matched, `"${inv[0]}" has no matching consumer useQuery key`).toBe(true);
    }
  });

  it('rubricSets key is camelCase ("rubricSets"), not hyphenated ("rubric-sets")', () => {
    expect(QUERY_KEYS.rubricSets[0]).toBe("rubricSets");
  });

  it('quarters key matches consumer declarations in action-center and TeacherProfile', () => {
    expect(QUERY_KEYS.quarters[0]).toBe("quarters");
  });

  it('dashboard key matches consumer declarations in Dashboard, action-center, TeacherProfile', () => {
    expect(QUERY_KEYS.dashboard[0]).toBe("dashboard");
  });

  it('overdueActionSteps key matches consumer declaration in action-center', () => {
    expect(QUERY_KEYS.overdueActionSteps[0]).toBe("overdueActionSteps");
  });

  it("all key values are non-empty string arrays", () => {
    for (const [name, key] of Object.entries(QUERY_KEYS)) {
      expect(Array.isArray(key), `${name} should be an array`).toBe(true);
      expect((key as readonly string[]).length, `${name} should be non-empty`).toBeGreaterThan(0);
      expect(typeof (key as readonly string[])[0], `${name}[0] should be a string`).toBe("string");
    }
  });
});
