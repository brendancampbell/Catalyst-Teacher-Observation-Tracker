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
