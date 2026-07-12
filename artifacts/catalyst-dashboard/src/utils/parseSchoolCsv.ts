import Papa from "papaparse";
import { type BulkSchoolRow } from "@/lib/api";

export const CSV_HEADERS = ["Display Name", "Full Name", "Abbreviation", "Region", "Grade Span"] as const;

export function parseSchoolCsv(text: string): { rows: BulkSchoolRow[]; headerError: string | null } {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  const result = Papa.parse<string[]>(cleaned, {
    skipEmptyLines: true,
  });

  if (result.data.length === 0) return { rows: [], headerError: "CSV is empty" };

  const header = result.data[0].map((h) => h.trim());
  const expected = CSV_HEADERS as readonly string[];

  if (header.length !== expected.length || expected.some((col, i) => header[i] !== col)) {
    return {
      rows: [],
      headerError: `Header row must be exactly: ${expected.join(", ")} (in that order). Got: ${header.join(", ")}`,
    };
  }

  const rows: BulkSchoolRow[] = [];

  for (let i = 1; i < result.data.length; i++) {
    const cols = result.data[i];
    const get  = (colIdx: number) => (cols[colIdx] ?? "").trim();
    rows.push({
      displayName:  get(0),
      fullName:     get(1),
      abbreviation: get(2),
      region:       get(3),
      gradeSpan:    get(4),
    });
  }

  return { rows, headerError: null };
}
