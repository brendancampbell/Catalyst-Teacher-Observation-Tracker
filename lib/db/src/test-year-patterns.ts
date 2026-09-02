/**
 * Which school year names were created by the test suite.
 *
 * Separated from cleanup-test-school-years.ts so the part that decides what
 * gets DELETED can be tested without a database.
 *
 * ── The governing rule: only delete what a test provably made ─────────────
 * A false negative leaves debris, which is untidy. A false positive deletes a
 * real school year — and every observation, action step and rubric set is
 * scoped by one. So the patterns are read out of the suite rather than
 * inferred from names that look testish, and anything unrecognised is reported
 * for a person to look at instead of removed.
 *
 * ── Why these are regexes and not SQL LIKE ────────────────────────────────
 * The first draft used LIKE patterns: "TST Rollover %". That is a prefix
 * match, so it also claims "TST Rollover 123 (keep)" — a name someone might
 * pick precisely to stop it being deleted. Every one of these years is created
 * as `TST Something ${Date.now()}`, so the pattern can require exactly that:
 * the prefix, then a timestamp, then the end of the string. Nothing else.
 */

/** A name a test in this repository is known to create. */
export interface TestYearPattern {
  /** Matches the whole name, anchored. */
  regex: RegExp;
  /** Human-readable form, for the cleanup report. */
  label: string;
  /** The file that creates it, so this list can be re-verified later. */
  source: string;
}

/** `Date.now()` is 13 digits; 10 is headroom without admitting short numbers. */
const TS = String.raw`\d{10,}`;

export const TEST_YEAR_PATTERNS: TestYearPattern[] = [
  {
    regex:  new RegExp(`^TST Empty ${TS}$`),
    label:  "TST Empty <timestamp>",
    source: "test-school-year-rollover.ts",
  },
  {
    regex:  new RegExp(`^TST Rollover ${TS}$`),
    label:  "TST Rollover <timestamp>",
    source: "test-school-year-rollover.ts",
  },
  {
    regex:  new RegExp(`^TST SY Cache ${TS}$`),
    label:  "TST SY Cache <timestamp>",
    source: "test-school-year-activation-cache.ts",
  },
  {
    regex:  new RegExp(`^TST-INSIGHTS-OLD-YR-${TS}$`),
    label:  "TST-INSIGHTS-OLD-YR-<timestamp>",
    source: "test-ai-insights-rubric-year-scoping.ts",
  },
  {
    regex:  new RegExp(`^TST-TEACHER-OLD-YR-${TS}$`),
    label:  "TST-TEACHER-OLD-YR-<timestamp>",
    source: "test-teacher-rubric-year-scoping.ts",
  },
  {
    regex:  new RegExp(`^TST Cap (?:Full|Empty) ${TS}$`),
    label:  "TST Cap Full/Empty <timestamp>",
    source: "test-rubric-set-cap-per-year.ts",
  },
  {
    regex:  new RegExp(`^TST Slug Cross-Year ${TS}$`),
    label:  "TST Slug Cross-Year <timestamp>",
    source: "test-rubric-category-domain-validation.ts",
  },
  {
    /*
     * Historical. This test used a fixed name and, because its cleanup
     * deleted the school year before the rubric set pointing at it, failed
     * silently on a foreign key violation every run — fourteen identical rows
     * by 2026-08-20. Fixed in test-rubric-category-domain-validation.ts, which
     * now uses the timestamped name above.
     *
     * Kept so the cleanup still recognises strays left by an older checkout.
     */
    regex:  /^Test Year \(slug cross-year\)$/,
    label:  "Test Year (slug cross-year)  [legacy]",
    source: "test-rubric-category-domain-validation.ts",
  },
];

/** The pattern this name was created by, or null if no test creates it. */
export function matchTestYearPattern(name: string): TestYearPattern | null {
  return TEST_YEAR_PATTERNS.find((p) => p.regex.test(name)) ?? null;
}
