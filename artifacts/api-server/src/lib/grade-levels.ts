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
