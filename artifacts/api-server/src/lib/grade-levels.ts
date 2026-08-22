/**
 * Grade-level parsing for people imports.
 *
 * grade_level is a text[] and has always been multi-value: the Users tab
 * toggles grades individually, so a hand-edited teacher stores ["6","7","8"].
 * Imports did not agree. The CSV template and the on-screen column help both
 * documented a HYPHEN separator ("6-7-8"), while the importer split on commas
 * only — so an imported teacher stored ["6-7-8"], a single string, and never
 * matched a hand-edited one.
 *
 * Both separators are now accepted, because both are already in the data.
 *
 * ── Why hyphens need care ─────────────────────────────────────────────────
 * A hyphen is a legitimate character inside a grade name — "Pre-K" is the
 * obvious one. Splitting on every hyphen would turn it into ["Pre", "K"].
 * So a token is only split on hyphens when EVERY resulting part is a bare
 * grade token (K, PK, TK, or a number):
 *
 *     "6-7-8"  → ["6","7","8"]     every part is bare
 *     "K-1"    → ["K","1"]         every part is bare (the documented example)
 *     "Pre-K"  → ["Pre-K"]         "Pre" is not, so leave it alone
 *
 * Commas and semicolons are unambiguous and always split.
 *
 * ── A caveat this cannot solve ────────────────────────────────────────────
 * A comma inside an UNQUOTED CSV field splits the row, not the value — the
 * field count grows and every later column shifts. That damage happens in the
 * CSV reader before this function ever sees the value. Quote the field
 * ("4, 5, 6"), which is what standard CSV requires. parsePeopleCSV flags rows
 * whose column count does not match the header so this fails loudly.
 */

/** K, PK, TK or a 1–2 digit number — the parts a hyphen may safely separate. */
const BARE_GRADE = /^(?:K|PK|TK|\d{1,2})$/i;

/**
 * Spreadsheets treat a grade column as numeric and export "5.00" for grade 5.
 * Stored as-is it never matches the "5" the Users tab writes, so the same
 * teacher reads differently depending on how they were entered. Trailing
 * zeros after a decimal point carry no meaning for a grade level.
 */
function normaliseGrade(value: string): string {
  const asDecimal = /^(\d{1,2})\.0+$/.exec(value);
  return asDecimal ? asDecimal[1]! : value;
}

/**
 * Normalise a gradeLevel field into a de-duplicated list of grades.
 * Accepts an array (the manual editor's shape) or a delimited string
 * (the CSV shape), and returns [] for anything empty or unparseable.
 */
export function parseGradeLevels(raw: unknown): string[] {
  let tokens: string[];

  if (Array.isArray(raw)) {
    tokens = (raw as unknown[]).map((g) => String(g).trim());
  } else if (typeof raw === "string") {
    tokens = raw.split(/[,;]/).map((g) => g.trim());
  } else {
    return [];
  }

  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string): void => {
    const value = normaliseGrade(raw);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };

  for (const token of tokens) {
    if (!token) continue;

    if (token.includes("-")) {
      const parts = token.split("-").map((p) => p.trim());
      if (parts.length > 1 && parts.every((p) => BARE_GRADE.test(p))) {
        for (const part of parts) push(part);
        continue;
      }
    }

    push(token);
  }

  return out;
}

/**
 * A grade this system recognises: Pre-K, TK, K, or 1 through 12.
 *
 * Nothing validated grades before. Whatever the spreadsheet said went into the
 * database verbatim, which is how a teacher ended up assigned to a grade
 * called "Oct 11".
 */
const VALID_GRADE = /^(?:PRE-?K|PK|TK|K|[1-9]|1[0-2])$/i;

export function isValidGrade(token: string): boolean {
  return VALID_GRADE.test(token.trim());
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/**
 * Undo Excel turning a pair of grades into a date.
 *
 * Typing "10, 11" or "10-11" into a cell Excel has decided is a date gets
 * silently rewritten — the sheet then reads "Oct 11", and the export carries
 * that through to us. Reported from production 2026-08-21, where a teacher of
 * grades 10 and 11 was recorded as teaching "Oct 11".
 *
 * ── Why this is safe to undo automatically ──
 * A grade is 1-12 and a month is 1-12, so when BOTH numbers fall in range the
 * pair is the same set whichever way round it was read: "Oct 11" and "11 Oct"
 * both mean {10, 11}, and so does "10/11/2026" under either date convention.
 * There is no ambiguity left to guess at.
 *
 * When the day is outside 1-12 it cannot be a grade — "Oct 25" is a real date
 * and not a mangled pair — so this returns null and the caller rejects the row
 * rather than inventing something.
 */
export function repairExcelDate(token: string): string[] | null {
  const raw = token.trim().toUpperCase();

  const pair = (a: number, b: number): string[] | null => {
    if (a < 1 || a > 12 || b < 1 || b > 12) return null;
    if (a === b) return [String(a)];
    return [a, b].sort((x, y) => x - y).map(String);
  };

  /* "OCT 11", "OCT-11", "OCTOBER 11" */
  let m = /^([A-Z]{3,9})[\s.-]+(\d{1,2})$/.exec(raw);
  if (m) {
    const month = MONTHS[m[1]!.slice(0, 3)!];
    return month ? pair(month, Number(m[2])) : null;
  }

  /* "11-OCT", "10 NOV" */
  m = /^(\d{1,2})[\s.-]+([A-Z]{3,9})$/.exec(raw);
  if (m) {
    const month = MONTHS[m[2]!.slice(0, 3)!];
    return month ? pair(Number(m[1]), month) : null;
  }

  /* "10/11/2026" — the numbers are interchangeable here, see above. */
  m = /^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/.exec(raw);
  if (m) return pair(Number(m[1]), Number(m[2]));

  /* "2026-10-11" */
  m = /^\d{4}-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (m) return pair(Number(m[1]), Number(m[2]));

  return null;
}

export interface GradeParseResult {
  /** Valid grades, de-duplicated, in first-seen order. */
  grades:   string[];
  /** Values Excel mangled into dates, and what they were turned back into. */
  repaired: { from: string; to: string[] }[];
  /** Values that are not grades and could not be repaired. */
  invalid:  string[];
}

/**
 * parseGradeLevels, plus what it had to fix and what it could not.
 *
 * The import uses this so an unrecognised grade fails the row with a message
 * naming the value, instead of being written to the database as if it were a
 * real grade.
 */
export function parseGradeLevelsDetailed(raw: unknown): GradeParseResult {
  const repaired: { from: string; to: string[] }[] = [];
  const invalid:  string[] = [];
  const grades:   string[] = [];
  const seen = new Set<string>();

  const keep = (value: string): void => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    grades.push(value);
  };

  for (const token of parseGradeLevels(raw)) {
    if (isValidGrade(token)) { keep(token); continue; }

    const fixed = repairExcelDate(token);
    if (fixed) {
      repaired.push({ from: token, to: fixed });
      for (const g of fixed) keep(g);
      continue;
    }
    invalid.push(token);
  }

  return { grades, repaired, invalid };
}
