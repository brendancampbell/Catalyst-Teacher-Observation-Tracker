import { deleteObservation, HttpError } from "@/lib/api";
import { buildObservationDeleteWarning } from "@/lib/observation-delete-warning";

/**
 * Delete an observation, asking first if action steps would go with it.
 *
 * The server refuses with 409 rather than guessing, and says which steps would
 * be lost — so the question put to the person names them instead of warning
 * about deletion in the abstract. Steps another observation has touched are
 * moved rather than deleted and are not mentioned; nothing is lost there.
 *
 * Returns false when the person declines, so callers can leave their own state
 * alone. Anything other than that 409 is re-thrown untouched.
 */
export async function deleteObservationSafely(observationId: string): Promise<boolean> {
  try {
    await deleteObservation(observationId);
    return true;
  } catch (err) {
    const blocked =
      err instanceof HttpError &&
      err.status === 409 &&
      err.code === "ACTION_STEPS_WOULD_BE_DELETED";

    if (!blocked) throw err;

    const warning = buildObservationDeleteWarning((err as HttpError).stepsToDelete ?? []);
    if (!window.confirm(warning)) return false;

    await deleteObservation(observationId, true);
    return true;
  }
}
