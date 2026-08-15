/**
 * Shared constants for rubric-set enforcement.
 * Imported by both the route (POST /rubric/sets) and its validation test so
 * the two never drift out of sync.
 */

/** Maximum number of non-archived rubric sets allowed at any one time. */
export const MAX_ACTIVE_SETS = 6;
