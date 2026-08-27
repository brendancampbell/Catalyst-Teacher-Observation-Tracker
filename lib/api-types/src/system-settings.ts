/**
 * Network-wide settings: the two deadlines that used to be hardcoded at 14
 * days.
 *
 * Both are carried in DAYS. The rescore window is presented in weeks because
 * that is how a rescore deadline is spoken about; the overdue window is
 * entered as days directly. Keeping one unit underneath means the arithmetic
 * never has to know which control it came from.
 */

/** The rescore window, offered as whole weeks. */
export const RESCORE_WINDOW_WEEK_OPTIONS = [1, 2, 3, 4] as const;

export const DAYS_PER_WEEK = 7;

/** Bounds for the overdue window, entered as a number of days. */
export const OVERDUE_WINDOW_MIN_DAYS = 1;
export const OVERDUE_WINDOW_MAX_DAYS = 30;

/** What both windows were hardcoded to, and therefore what they default to. */
export const DEFAULT_WINDOW_DAYS = 14;

export interface SystemSettings {
  rescoreWindowDays: number;
  overdueWindowDays: number;
  /** Null until somebody changes that control. */
  rescoreUpdatedAt:  string | null;
  rescoreUpdatedBy:  string | null;
  overdueUpdatedAt:  string | null;
  overdueUpdatedBy:  string | null;
}

export interface SystemSettingsUpdate {
  rescoreWindowDays?: number;
  overdueWindowDays?: number;
}

/**
 * What a change would do, asked for before it is saved.
 *
 * Shortening either window has consequences that are invisible at the moment
 * of choosing: teachers whose recalculated deadline has already passed, and
 * teachers who appear in Overdue Observations the next morning. The counts are
 * measured rather than estimated.
 */
export interface SystemSettingsPreview {
  /** Rescore entries whose recalculated due date would be in the past. */
  rescoreNewlyOverdue:  number;
  /** Rescore entries that would move at all. */
  rescoreAffected:      number;
  /** Teachers who would newly appear in Overdue Observations. */
  overdueNewlyListed:   number;
}

export function weeksToDays(weeks: number): number {
  return weeks * DAYS_PER_WEEK;
}

/**
 * The rescore window as whole weeks, or null when it is not a whole number of
 * them — which the dropdown cannot produce, but a hand-edited database can.
 * Callers show the raw day count in that case rather than rounding silently.
 */
export function daysToWholeWeeks(days: number): number | null {
  return days % DAYS_PER_WEEK === 0 ? days / DAYS_PER_WEEK : null;
}

/** "3 weeks", or "17 days" when it is not a whole number of weeks. */
export function describeWindow(days: number): string {
  const weeks = daysToWholeWeeks(days);
  if (weeks === null) return `${days} day${days === 1 ? "" : "s"}`;
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}
