/**
 * Canonical React Query key constants for the dashboard.
 *
 * All useQuery / invalidateQueries / setQueryData calls must reference
 * these constants instead of bare string literals, so that key drift
 * between producers and consumers is caught at compile time.
 *
 * Usage:
 *   queryKey: QUERY_KEYS.rubricSets                    // plain key
 *   queryKey: [...QUERY_KEYS.dashboard, q, schoolId]   // parameterised
 *   invalidateQueries({ queryKey: QUERY_KEYS.dashboard }) // prefix match
 */
export const QUERY_KEYS = {
  // ── School-year admin ────────────────────────────────────────────
  adminSchoolYears:     ["admin-school-years"]     as const,
  schoolYearRubricSets: ["school-year-rubric-sets"] as const,
  rubricSetsForCopy:    ["rubric-sets-for-copy"]   as const,
  activationPreview:    ["activation-preview"]     as const,

  // ── Rubric sets (camelCase key — NOT hyphenated) ─────────────────
  rubricSets:           ["rubricSets"]             as const,

  // ── Dashboard & analytics ────────────────────────────────────────
  dashboard:            ["dashboard"]              as const,
  quarters:             ["quarters"]               as const,
  district:             ["district"]               as const,
  districtSummary:      ["district-summary"]       as const,
  networkAverages:      ["network-averages"]       as const,

  // ── Action center ────────────────────────────────────────────────
  overdueActionSteps:   ["overdueActionSteps"]     as const,
  rescoreQueue:         ["rescoreQueue"]           as const,
  overdueObservations:  ["overdueObservations"]    as const,
  aiInsights:           ["ai-insights"]            as const,
  aiCalibrationFlags:   ["ai-calibration-flags"]   as const,

  // ── Qualitative themes ───────────────────────────────────────────
  qualitativeThemes:    ["qualitative-themes"]     as const,

  // ── Schools / users ──────────────────────────────────────────────
  adminSchools:         ["adminSchools"]           as const,
  people:               ["people"]                 as const,

  // ── Teacher profile ──────────────────────────────────────────────
  actionSteps:          ["action-steps"]           as const,
  personName:           ["person-name"]            as const,

  // ── Drafts ───────────────────────────────────────────────────────
  myDrafts:             ["myDrafts"]               as const,

  // ── AI chat ──────────────────────────────────────────────────────
  chatSessions:         ["chatSessions"]           as const,
  chatMessages:         ["chatMessages"]           as const,
  aiQuotaStatus:        ["ai-quota-status"]        as const,
  aiQuotaGrantsAll:     ["ai-quota-grants-all"]    as const,

  // ── Rubric detail (admin edit) ───────────────────────────────────
  rubric:               ["rubric"]                 as const,

  // ── My latest rubric slug ────────────────────────────────────────
  myLatestRubricSlug:   ["myLatestRubricSlug"]     as const,
} as const;
