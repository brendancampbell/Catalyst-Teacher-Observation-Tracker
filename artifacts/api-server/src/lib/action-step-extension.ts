/**
 * Extending an action step's due date.
 *
 * "Repeat last action step" used to copy the text and due date into the new
 * action step box, so saving created a SECOND open step saying the same thing.
 * A teacher working on one thing for a term collected a list of identical
 * steps, and the coaching history of that work was split across all of them.
 *
 * Extending the original keeps it as one step, and action_step_extensions
 * records each push so "extended three times, originally due 3 October"
 * survives — the signal that a teacher is stuck.
 *
 * The shape checks live here, separate from the route, because POST
 * /observations and PUT /observations/:id both accept the same field and must
 * enforce the same rules. Two copies of a validation rule is two rules.
 */

export interface ExtendActionStepInput {
  actionStepId: number;
  newDueDate:   string;
  note?:        string | null;
}

export type ExtensionCheck = { ok: true } | { ok: false; error: string };

/** Longer than any real "teacher was out two weeks" note. */
export const MAX_EXTENSION_NOTE = 500;

/**
 * Validate an extension request against the rest of the payload.
 *
 * `today` is passed in rather than read here so the caller controls the clock
 * and the tests do not depend on the day they run.
 */
export function validateExtensionRequest(
  extend: unknown,
  hasNewActionStep: boolean,
  today: string,
): ExtensionCheck {
  if (extend === undefined || extend === null) return { ok: true };

  /*
   * Extending and assigning are two different answers to "what next for this
   * teacher", and doing both in one observation is almost certainly a mistake
   * — the UI hides one when you pick the other, and this stops anything else
   * from doing it.
   */
  if (hasNewActionStep) {
    return {
      ok: false,
      error: "An observation can either extend the existing action step or assign a new one, not both",
    };
  }

  if (typeof extend !== "object") {
    return { ok: false, error: "extendActionStep must be an object" };
  }
  const { actionStepId, newDueDate, note } = extend as Partial<ExtendActionStepInput>;

  if (!Number.isInteger(actionStepId) || (actionStepId as number) <= 0) {
    return { ok: false, error: "extendActionStep.actionStepId must be a positive integer" };
  }
  if (typeof newDueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(newDueDate)) {
    return { ok: false, error: "extendActionStep.newDueDate must be a valid ISO date (YYYY-MM-DD)" };
  }
  /*
   * Same rule as a new action step. It matters more here: the whole reason to
   * extend is that the old date has passed, so prefilling the old one — which
   * is what the button used to do — produced an immediate validation error.
   */
  if (newDueDate < today) {
    return { ok: false, error: "extendActionStep.newDueDate must be today or in the future" };
  }
  if (note !== undefined && note !== null) {
    if (typeof note !== "string") {
      return { ok: false, error: "extendActionStep.note must be a string" };
    }
    if (note.length > MAX_EXTENSION_NOTE) {
      return { ok: false, error: `extendActionStep.note must be ${MAX_EXTENSION_NOTE} characters or fewer` };
    }
  }
  return { ok: true };
}

/**
 * Whether this step can be extended at all, given who it belongs to.
 *
 * Separate from the shape check because it needs the step out of the database.
 * Only an OPEN step belonging to the observed teacher qualifies: extending a
 * mastered step would reopen finished work, and extending someone else's is a
 * cross-teacher write.
 */
export function checkStepIsExtendable(
  step: { teacherEmployeeId: string; status: string } | null | undefined,
  observedEmployeeId: string | null | undefined,
): ExtensionCheck {
  if (!step) return { ok: false, error: "extendActionStep.actionStepId not found" };
  if (!observedEmployeeId || step.teacherEmployeeId !== observedEmployeeId) {
    return { ok: false, error: "That action step belongs to a different teacher" };
  }
  if (step.status !== "open") {
    return { ok: false, error: "Only an open action step can be extended" };
  }
  return { ok: true };
}
