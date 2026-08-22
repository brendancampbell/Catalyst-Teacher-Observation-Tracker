/**
 * Grade levels: what counts as one, and how to read a mangled one.
 *
 * Shared because it is enforced in three places — the CSV import, the
 * create/edit endpoints, and the cleanup script that repairs what was stored
 * before any of this existed. The cleanup script originally carried its own
 * copy and immediately disagreed with the real parser: it could not read
 * "5-6-7-8", so thirty people looked unrepairable when they were not.
 */

/** K, or 1 through 12. */
const VALID_GRADE = /^(?:K|[1-9]|1[0-2])$/i;

export function isValidGrade(token: string): boolean {
  return VALID_GRADE.test(token.trim());
}

/** K, or a 1-2 digit number — the parts a hyphen may safely separate. */
const BARE_GRADE = /^(?:K|\d{1,2})$/i;

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/**
 * Spreadsheets treat a grade column as numeric and export "5.00" for grade 5.
 * Stored as-is it never matches the "5" the Users tab writes.
 */
function normaliseGrade(value: string): string {
  const asDecimal = /^(\d{1,2})\.0+$/.exec(value);
  return asDecimal ? asDecimal[1]! : value;
}

/**
 * Undo Excel turning a list of grades into a date.
 *
 * Typing "2, 3, 4" or "10-11" into a cell Excel has decided is a date gets
 * silently rewritten, and the export carries the result through to us: "3-Feb",
 * "2/3/04", "12-Nov". Found in production 2026-08-21 on 122 people.
 *
 * ── The rule, and why it is not a guess ──
 * Split on any separator, turn month names into numbers, and accept ONLY if
 * every part is itself a valid grade. Order does not matter because a grade
 * and a month occupy the same 1-12 range, so "Oct 11" and "11 Oct" mean the
 * same set either way.
 *
 * Requiring EVERY part to be a grade is what makes it safe, and is what the
 * first version got wrong: it read "2/3/04" as month and day only and returned
 * grades 2 and 3, silently dropping the 4. Now a part that cannot be a grade —
 * the 58 in "5/6/58", the 24 in "24-Sep", the year in "2026-10-11" — makes the
 * whole value unreadable, and the caller reports it instead of inventing
 * something.
 */
export function repairExcelDate(token: string): string[] | null {
  const parts = token.trim().toUpperCase().split(/[\s./-]+/).filter(Boolean);
  if (parts.length < 2) return null;

  const numbers: number[] = [];
  for (const part of parts) {
    const month = MONTHS[part.slice(0, 3)];
    if (month !== undefined && /^[A-Z]{3,9}$/.test(part)) { numbers.push(month); continue; }
    if (!/^\d{1,4}$/.test(part)) return null;
    const n = Number(part);
    if (n < 1 || n > 12) return null;      /* not a grade — refuse the lot */
    numbers.push(n);
  }

  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  return unique.length > 0 ? unique.map(String) : null;
}

/**
 * Normalise a gradeLevel field into a de-duplicated list.
 *
 * Accepts an array (the picker's shape) or a delimited string (the CSV shape).
 * Hyphens are split only when every part is a bare grade, so "6-7-8" becomes
 * three grades while "Pre-K" survives as one token — and is then rejected as
 * invalid, which is what the network wants.
 */
export function parseGradeLevels(raw: unknown): string[] {
  let tokens: string[];
  if (Array.isArray(raw)) tokens = (raw as unknown[]).map((g) => String(g).trim());
  else if (typeof raw === "string") tokens = raw.split(/[,;]/).map((g) => g.trim());
  else return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const v = normaliseGrade(value);
    const key = v.toLowerCase();
    if (!v || seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  for (const token of tokens) {
    if (!token) continue;
    const parts = token.split("-").map((p) => p.trim());
    if (parts.length > 1 && parts.every((p) => BARE_GRADE.test(p))) {
      for (const p of parts) push(p);
    } else {
      push(token);
    }
  }
  return out;
}

export interface GradeParseResult {
  grades:   string[];
  repaired: { from: string; to: string[] }[];
  invalid:  string[];
}

/** parseGradeLevels, plus what it had to repair and what it could not. */
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
