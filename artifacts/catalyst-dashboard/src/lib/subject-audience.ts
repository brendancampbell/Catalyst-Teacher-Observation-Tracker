export type SubjectAudience = "STEM" | "HUMANITIES" | "ALL";

const STEM_SUBJECTS = new Set([
  "math", "mathematics", "algebra", "geometry", "calculus", "statistics",
  "science", "biology", "chemistry", "physics", "earth science",
  "compsci", "computer science", "cs", "computing", "engineering",
  "technology", "stem",
]);

const HUMANITIES_SUBJECTS = new Set([
  "ela", "english", "english language arts", "language arts",
  "history", "social studies", "geography", "civics", "economics",
  "humanities", "reading", "writing", "literature",
]);

/**
 * Returns the audience bucket for a teacher's subject.
 * Returns "ALL" for unclassified subjects (Art, PE, Music, etc.) and null subjects.
 * Those teachers only appear when the rubric audience is "ALL".
 */
export function classifySubject(subject: string | null | undefined): SubjectAudience {
  if (!subject) return "ALL";
  const normalized = subject.toLowerCase().trim();
  if (STEM_SUBJECTS.has(normalized)) return "STEM";
  for (const s of STEM_SUBJECTS) { if (normalized.includes(s)) return "STEM"; }
  if (HUMANITIES_SUBJECTS.has(normalized)) return "HUMANITIES";
  for (const s of HUMANITIES_SUBJECTS) { if (normalized.includes(s)) return "HUMANITIES"; }
  return "ALL";
}

/**
 * Whether a teacher with the given subject should appear in the dropdown
 * when a rubric with the given audience is selected.
 *
 * - STEM audience   → only STEM teachers
 * - HUMANITIES audience → only Humanities teachers
 * - ALL audience    → every teacher
 * - Unclassified teachers (Art, PE, Music, null) → only for ALL audience
 */
export function teacherMatchesAudience(
  subject: string | null | undefined,
  audience: SubjectAudience,
): boolean {
  if (audience === "ALL") return true;
  return classifySubject(subject) === audience;
}

/**
 * The rubrics on a teacher's profile, out of the ones already valid for their
 * school.
 *
 * Filtering happens in two places because the two questions belong to
 * different things. Whether a rubric is school-wide, and whether it covers the
 * right grade span, are facts about the SCHOOL — the dashboard settles those
 * once for everybody. Whether it covers the right subject is a fact about the
 * TEACHER, and that is this.
 *
 * Callers must pass a list that has already had school-wide and wrong-grade
 * rubrics removed. This function does not check either, because it cannot: it
 * is given no school.
 */
export function rubricSetsForTeacher<T extends { subjectAudience?: SubjectAudience | null }>(
  sets: T[],
  subject: string | null | undefined,
): T[] {
  return sets.filter((rs) => teacherMatchesAudience(subject, rs.subjectAudience ?? "ALL"));
}
