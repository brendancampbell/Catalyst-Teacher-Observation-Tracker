/**
 * Departments, and which rubrics each one's teachers appear under.
 *
 * ONE source. This used to exist twice — the dashboard classified by keyword,
 * the mobile app by an explicit map — and they drifted: Spanish was in
 * mobile's map and missing from the dashboard's keywords, so the same teacher
 * appeared under a Humanities rubric on a phone and vanished on a desktop.
 * Nothing forced them to agree, and only one of the two was ever tested.
 *
 * Lives here because api-types depends on nothing and everything depends on
 * it: both apps, and lib/db, which builds its Postgres enum from
 * DEPARTMENT_VALUES below. Adding a department is now one edit.
 */

export type SubjectAudience = "STEM" | "HUMANITIES" | "ALL";

/**
 * Every department, in the order they appear in menus. Postgres builds
 * department_enum from this, so the two orders cannot diverge.
 *
 * Adding one: put it here, then generate a migration. The audience map below
 * is typed against this list, so TypeScript refuses to compile until the new
 * department is classified — which is the whole point.
 */
export const DEPARTMENT_VALUES = [
  "English",
  "Math",
  "Science",
  "History",
  "Spanish",
  "Physical Education",
  "Comp Sci/Engineering",
  "Visual Arts",
  "College",
  "SpEd",
  "Other",
] as const;

export type Department = typeof DEPARTMENT_VALUES[number];

/**
 * Where each department sits.
 *
 * Read "ALL" carefully: it is the NARROWEST outcome, not the widest. A teacher
 * classified ALL appears only when the rubric audience is also ALL. It means
 * "this subject does not belong to STEM or Humanities", not "this teacher
 * belongs everywhere" — see EVERY_AUDIENCE for that.
 */
export const DEPARTMENT_AUDIENCE: Record<Department, SubjectAudience> = {
  "Math":                 "STEM",
  "Science":              "STEM",
  "Comp Sci/Engineering": "STEM",
  "English":              "HUMANITIES",
  "History":              "HUMANITIES",
  "Spanish":              "HUMANITIES",
  "Physical Education":   "ALL",
  "Visual Arts":          "ALL",
  "College":              "ALL",
  "SpEd":                 "ALL",
  "Other":                "ALL",
};

/**
 * Departments belonging to EVERY audience rather than to one bucket.
 *
 * A SpEd teacher may teach any subject, so they should appear whichever rubric
 * is selected. This is the opposite of an unclassified department, which
 * appears only on an ALL rubric.
 */
const EVERY_AUDIENCE: ReadonlySet<string> = new Set(["sped"]);

/* Keyword fallback, kept only for values that are not one of the departments
   above — legacy free-text subjects from before the enum existed. A real
   department never reaches this. */
const STEM_KEYWORDS = [
  "math", "mathematics", "algebra", "geometry", "calculus", "statistics",
  "science", "biology", "chemistry", "physics", "earth science",
  "compsci", "computer science", "cs", "computing", "engineering",
  "technology", "stem",
];

const HUMANITIES_KEYWORDS = [
  "ela", "english", "english language arts", "language arts",
  "history", "social studies", "geography", "civics", "economics",
  "humanities", "reading", "writing", "literature", "spanish",
];

/**
 * The audience bucket for a teacher's department.
 *
 * Returns "ALL" for an empty value, and for anything unrecognised.
 */
export function classifySubject(subject: string | null | undefined): SubjectAudience {
  if (!subject) return "ALL";
  const trimmed = subject.trim();
  if (!trimmed) return "ALL";

  /* A real department is decided by the map, never by keywords — that is what
     keeps this predictable. */
  if (Object.prototype.hasOwnProperty.call(DEPARTMENT_AUDIENCE, trimmed)) {
    return DEPARTMENT_AUDIENCE[trimmed as Department];
  }

  const normalized = trimmed.toLowerCase();
  for (const s of STEM_KEYWORDS)       if (normalized.includes(s)) return "STEM";
  for (const s of HUMANITIES_KEYWORDS) if (normalized.includes(s)) return "HUMANITIES";

  /* Nothing matched at all. Departments are an enum, so this means a value
     reached us that nobody has classified — say so rather than silently
     filing the teacher under ALL, where they will quietly stop appearing on
     STEM and Humanities rubrics. */
  /* Reached through globalThis because this package deliberately has neither
     DOM nor Node types — it is shared by a browser app, a phone app and the
     server, and should not assume any of them. */
  (globalThis as { console?: { warn?: (message: string) => void } })
    .console?.warn?.(`classifySubject: unknown department value "${trimmed}" — falling back to "ALL"`);
  return "ALL";
}

/**
 * Whether a teacher with this department should appear when a rubric with the
 * given audience is selected.
 *
 * - ALL rubric          → every teacher
 * - STEM rubric         → STEM teachers, plus SpEd
 * - HUMANITIES rubric   → Humanities teachers, plus SpEd
 * - unclassified teacher (Visual Arts, PE, College, Other, none) → ALL only
 */
export function teacherMatchesAudience(
  subject: string | null | undefined,
  audience: SubjectAudience,
): boolean {
  if (audience === "ALL") return true;
  if (subject && EVERY_AUDIENCE.has(subject.trim().toLowerCase())) return true;
  return classifySubject(subject) === audience;
}
