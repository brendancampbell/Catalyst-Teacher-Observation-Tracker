import type { Observation } from "@workspace/api-types";

/**
 * Who may correct or remove a given observation.
 *
 * Two ways in, and the server enforces both independently — this only decides
 * whether the buttons appear:
 *
 *   - you wrote it. A coach who filed an observation on the wrong teacher, or
 *     mistyped the date, can fix it themselves rather than finding a school
 *     leader. Not time-limited: an error found late is still an error.
 *   - you lead the school it belongs to. Unchanged.
 *
 * Deleting is not separated from editing. A coach who can rewrite every word
 * of their own observation is not meaningfully restrained by being unable to
 * remove it, and the delete already refuses without an explicit confirmation
 * naming what would go with it.
 *
 * Editing a filed observation is stamped with who did it and shown on the
 * observation, so none of this is silent.
 */
export function canEditObservation(
  observation: Pick<Observation, "observerEmployeeId"> | null | undefined,
  currentUser: { role?: string | null; employeeId?: string | null } | null | undefined,
): boolean {
  if (!currentUser) return false;

  const leadsTheSchool =
    currentUser.role === "SCHOOL_LEADER" ||
    currentUser.role === "NETWORK_LEADER" ||
    currentUser.role === "NETWORK_ADMIN";
  if (leadsTheSchool) return true;

  /* Both sides must be present. A null observer must never match a caller with
     no employee id, which would hand every legacy row to anybody. */
  return (
    !!observation?.observerEmployeeId &&
    !!currentUser.employeeId &&
    observation.observerEmployeeId === currentUser.employeeId
  );
}
