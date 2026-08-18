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

export function parsePeopleCSV(text: string): BulkImportPersonPayload[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const results: BulkImportPersonPayload[] = [];
  if (lines.length < 2) return results;

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
    const cols = parseCSVLine(line);
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
  return results;
}
