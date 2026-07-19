export type SubjectAudience = "STEM" | "HUMANITIES" | "ALL";

type Department =
  | "English"
  | "Math"
  | "Science"
  | "History"
  | "Spanish"
  | "Physical Education"
  | "Comp Sci/Engineering"
  | "Visual Arts"
  | "College"
  | "Other";

const DEPARTMENT_AUDIENCE: Record<Department, SubjectAudience> = {
  "Math":                 "STEM",
  "Science":              "STEM",
  "Comp Sci/Engineering": "STEM",
  "English":              "HUMANITIES",
  "History":              "HUMANITIES",
  "Spanish":              "HUMANITIES",
  "Physical Education":   "ALL",
  "Visual Arts":          "ALL",
  "College":              "ALL",
  "Other":                "ALL",
};

const KNOWN_DEPARTMENTS = new Set<string>(Object.keys(DEPARTMENT_AUDIENCE));

/**
 * Returns the audience bucket for a teacher's department value.
 * Returns "ALL" for null/undefined/empty and for any value not in the
 * known department enum (logs a console.warn so the gap is surfaced).
 */
export function classifySubject(subject: string | null | undefined): SubjectAudience {
  if (!subject) return "ALL";
  const trimmed = subject.trim();
  if (!trimmed) return "ALL";
  if (KNOWN_DEPARTMENTS.has(trimmed)) {
    return DEPARTMENT_AUDIENCE[trimmed as Department];
  }
  console.warn(`classifySubject: unknown department value "${trimmed}" — falling back to "ALL"`);
  return "ALL";
}

/**
 * Whether a teacher with the given subject should appear in the dropdown
 * when a rubric with the given audience is selected.
 *
 * - STEM audience        → only STEM teachers
 * - HUMANITIES audience  → only Humanities teachers
 * - ALL audience         → every teacher
 * - Unclassified teachers (Visual Arts, PE, College, null) → only for ALL audience
 */
export function teacherMatchesAudience(
  subject: string | null | undefined,
  audience: SubjectAudience,
): boolean {
  if (audience === "ALL") return true;
  return classifySubject(subject) === audience;
}
