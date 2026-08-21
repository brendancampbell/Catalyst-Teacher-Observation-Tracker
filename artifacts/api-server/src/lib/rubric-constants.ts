/**
 * Shared constants for rubric-set enforcement.
 * Imported by both the route (POST /rubric/sets) and its validation tests so
 * the two never drift out of sync.
 */

/**
 * Maximum non-archived rubric sets allowed IN ONE SCHOOL YEAR.
 *
 * Per year, not overall: the cap is about how many rubrics a school is being
 * scored against at once, which is a fact about a year. It used to be counted
 * across every year, so a rubric copied forward into next year — invisible on
 * a screen that only lists the active year — silently consumed a slot, and
 * creation started failing at what looked like five of six.
 *
 * Raised from 6 to 15 on 2026-08-21. Six was tight for a network already
 * running school-wide, classroom culture, DOS and subject-specific rubrics
 * side by side, and hitting the limit is how the counting bug surfaced.
 * Archived sets do not count, so archiving one always frees a slot.
 */
export const MAX_ACTIVE_SETS = 15;
