/* Departments and audiences live in @workspace/api-types — one source shared
   with the mobile app and with the database enum. Re-exported here so the many
   existing imports of "@/lib/subject-audience" keep working.

   rubricSetsForTeacher stays local: it is about this app's rubric list, not
   about what a department means. */
export {
  classifySubject,
  teacherMatchesAudience,
  DEPARTMENT_VALUES,
  DEPARTMENT_AUDIENCE,
} from "@workspace/api-types";
export type { SubjectAudience, Department } from "@workspace/api-types";

import { teacherMatchesAudience } from "@workspace/api-types";
import type { SubjectAudience } from "@workspace/api-types";

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
