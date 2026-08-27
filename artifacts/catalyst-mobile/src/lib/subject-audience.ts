/* Departments and audiences live in @workspace/api-types — one source shared
   with the dashboard and with the database enum.

   This file used to hold a second implementation: an explicit department map,
   while the dashboard matched keywords. They drifted, and a Spanish teacher
   appeared under a Humanities rubric here and nowhere on a desktop. Kept as a
   re-export so existing imports are undisturbed. */
export {
  classifySubject,
  teacherMatchesAudience,
  DEPARTMENT_VALUES,
  DEPARTMENT_AUDIENCE,
} from "@workspace/api-types";
export type { SubjectAudience, Department } from "@workspace/api-types";
