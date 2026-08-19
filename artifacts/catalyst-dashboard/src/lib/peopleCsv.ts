/**
 * CSV parsing for people/roster uploads.
 *
 * Shared by the Users tab's bulk import and the school-year rollover's roster
 * staging, so both accept exactly the same file. A roster file that imports
 * cleanly in one place must import cleanly in the other.
 */

import type { BulkImportPersonPayload } from "@workspace/api-types";

export function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let field = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field.trim());
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) {
        fields.push(line.slice(i).trim());
        break;
      }
      fields.push(line.slice(i, end).trim());
      i = end + 1;
    }
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
  if (lines.length < 2) return { rows: results, malformed, repaired };

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ""));
  const idx = (n: string) => headers.indexOf(n);
  const firstNameIdx = idx("firstname");
  const lastNameIdx  = idx("lastname");
  const empIdIdx     = idx("employeeid");
  const emailIdx     = idx("email");
  const roleIdx      = idx("role");
  const schoolIdx    = idx("school");
  const deptIdx      = idx("department");
  const gradeIdx     = idx("gradelevel");
  const obsIdx       = idx("includeinfeedbacktracker");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let cols = parseCSVLine(line);
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
  return { rows: results, malformed, repaired };
}
