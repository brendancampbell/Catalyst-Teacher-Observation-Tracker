/**
 * CSV parsing for people/roster uploads.
 *
 * Shared by the Users tab's bulk import and the school-year rollover's roster
 * staging, so both accept exactly the same file. A roster file that imports
 * cleanly in one place must import cleanly in the other.
 */

import type { BulkImportPersonPayload } from "@workspace/api-types";

/**
 * Work out what actually separates the fields.
 *
 * The importer assumed commas. Export tools disagree: Sheets and Excel will
 * happily produce tab-separated files, and European Excel uses semicolons.
 * A tab-separated file read as CSV yields ONE column, so every header lookup
 * misses, every field comes back empty, and the only rows that look broken
 * are the ones that happen to contain a comma — which reads as "unquoted
 * comma" when the truth is "wrong delimiter entirely".
 *
 * Header names never contain tabs, semicolons or commas, so whichever appears
 * most often in the header line is the delimiter.
 */
export function detectDelimiter(headerLine: string): string {
  const counts = [
    { d: "\t", n: (headerLine.match(/\t/g) ?? []).length },
    { d: ";",   n: (headerLine.match(/;/g)  ?? []).length },
    { d: ",",   n: (headerLine.match(/,/g)  ?? []).length },
  ].sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.d : ",";
}

export function parseCSVLine(line: string, delim: string = ","): string[] {
  const fields: string[] = [];
  let i = 0;

  for (;;) {
    if (line[i] === '"') {
      let field = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {   /* escaped quote */
          field += '"';
          i += 2;
        } else if (line[i] === '"') {                    /* closing quote */
          i++;
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field.trim());

      /*
       * A quoted field that ends the line ends the ROW. The previous version
       * looped once more here and pushed an empty string, so any row whose
       * LAST column was quoted came back with one field too many. Harmless
       * while columns were read positionally and the phantom sat past the end
       * — then the column-count check started rejecting those rows outright.
       * 132 of them in a real 2080-row export, all with a quoted `title`.
       */
      if (i >= line.length) break;
      if (line[i] === delim) { i++; continue; }
      break;                                             /* junk after the quote */
    }

    const end = line.indexOf(delim, i);
    if (end === -1) {
      fields.push(line.slice(i).trim());
      break;
    }
    fields.push(line.slice(i, end).trim());
    i = end + 1;
  }

  return fields;
}

/** A row whose column count disagrees with the header. */
export interface MalformedRow {
  /** 1-based line number in the file, header included. */
  line:     number;
  got:      number;
  expected: number;
}

export interface ParsedPeopleCSV {
  rows:      BulkImportPersonPayload[];
  /** What the file turned out to be separated by. */
  delimiter: string;
  /**
   * Known columns absent from the header. Previously these were silently
   * treated as empty for every row — a misnamed gradeLevel column meant no
   * grade was ever imported and nothing said so.
   */
  missing:   string[];
  /** Rows that had unquoted commas in gradeLevel and were reassembled. */
  repaired:  number;
  /**
   * Rows with MORE columns than the header — nearly always an unquoted comma
   * inside a field. The extra field shifts every later column, so
   * includeInFeedbackTracker silently picks up a grade. Surfacing these is the
   * difference between "your file is wrong" and quietly importing bad data.
   */
  malformed: MalformedRow[];
}

/*
 * A bare grade token. Deliberately narrow: this is the evidence used to decide
 * that stray columns came from an unquoted gradeLevel and not from a comma in
 * somebody's name or school. Kept in step with BARE_GRADE in the API's
 * lib/grade-levels.ts, which is the authority on what a grade may look like.
 */
const GRADE_TOKEN = /^(?:K|PK|TK|Pre-?K|\d{1,2})$/i;

/**
 * Rebuild a row whose gradeLevel field was written with unquoted commas.
 *
 * Standard CSV requires "4, 5, 6" to be quoted; plenty of export tools do not
 * bother, and the row then carries extra fields that shift every later column
 * — includeInFeedbackTracker silently receives a grade. The shape is
 * recoverable because we know which column is multi-valued and how many
 * columns there should be.
 *
 * It only fires when EVERY overflow piece looks like a grade. A comma in a
 * school name produces the same symptom and must not be silently folded into
 * gradeLevel, so anything unrecognisable leaves the row reported as malformed.
 */
function mendUnquotedGrades(cols: string[], expected: number, gradeIdx: number): string[] | null {
  if (gradeIdx < 0) return null;
  const extra = cols.length - expected;
  if (extra < 1) return null;

  const merged = cols.slice(gradeIdx, gradeIdx + extra + 1);
  if (merged.length < 2) return null;
  if (!merged.every((part) => GRADE_TOKEN.test(part.trim()))) return null;

  return [
    ...cols.slice(0, gradeIdx),
    merged.map((p) => p.trim()).join(","),
    ...cols.slice(gradeIdx + extra + 1),
  ];
}

export function parsePeopleCSV(text: string): ParsedPeopleCSV {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const results: BulkImportPersonPayload[] = [];
  const malformed: MalformedRow[] = [];
  let repaired = 0;
  if (lines.length < 2) {
    return { rows: results, malformed, repaired, delimiter: ",", missing: [] };
  }

  const delimiter = detectDelimiter(lines[0]!);
  const headers = parseCSVLine(lines[0]!, delimiter).map((h) => h.toLowerCase().replace(/\s+/g, ""));
  const missing: string[] = [];
  const idx = (n: string, label: string) => {
    const at = headers.indexOf(n);
    if (at < 0) missing.push(label);
    return at;
  };
  const firstNameIdx = idx("firstname", "firstName");
  const lastNameIdx  = idx("lastname", "lastName");
  const empIdIdx     = idx("employeeid", "employeeId");
  const emailIdx     = idx("email", "email");
  const roleIdx      = idx("role", "role");
  const schoolIdx    = idx("school", "school");
  const deptIdx      = idx("department", "department");
  const gradeIdx     = idx("gradelevel", "gradeLevel");
  const obsIdx       = idx("includeinfeedbacktracker", "includeInFeedbackTracker");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let cols = parseCSVLine(line, delimiter);
    if (cols.length > headers.length) {
      const mended = mendUnquotedGrades(cols, headers.length, gradeIdx);
      if (mended) {
        cols = mended;
        repaired++;
      } else {
        malformed.push({ line: i + 1, got: cols.length, expected: headers.length });
        continue;
      }
    }
    const gradRaw = gradeIdx >= 0 ? (cols[gradeIdx] ?? "") : "";
    results.push({
      firstName:  firstNameIdx >= 0 ? (cols[firstNameIdx] ?? "") : "",
      lastName:   lastNameIdx  >= 0 ? (cols[lastNameIdx]  ?? "") : "",
      employeeId: empIdIdx     >= 0 ? (cols[empIdIdx]     ?? "") : "",
      email:      emailIdx     >= 0 ? (cols[emailIdx]     ?? "") : "",
      role:       roleIdx      >= 0 ? (cols[roleIdx]      ?? "") : "",
      school:     schoolIdx    >= 0 ? (cols[schoolIdx]    ?? "") : "",
      department: deptIdx      >= 0 ? (cols[deptIdx]      ?? "") : "",
      gradeLevel: gradRaw,
      includeInFeedbackTracker: obsIdx >= 0 ? (cols[obsIdx] ?? "true") : "true",
    });
  }
  return { rows: results, malformed, repaired, delimiter, missing };
}
