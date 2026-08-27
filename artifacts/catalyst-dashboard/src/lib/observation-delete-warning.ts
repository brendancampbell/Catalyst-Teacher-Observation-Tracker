import type { ObservationStepImpact } from "@/lib/api";

/**
 * The sentence introducing the action steps a delete would take with it.
 *
 * Two cases, deliberately worded differently. An open step being deleted is a
 * retraction — the coach is taking back something they assigned. A MASTERED
 * step being deleted removes work the teacher has already done and been
 * credited for, which is a different thing to agree to, so it is named
 * explicitly rather than folded into a count.
 *
 * Steps another observation has touched are not passed here: they survive and
 * move, so nothing is lost and mentioning them would bury the part that
 * matters.
 *
 * Kept out of the dialog's markup so the distinction can be tested.
 */
export function buildObservationDeleteHeading(steps: ObservationStepImpact[]): string | null {
  if (steps.length === 0) return null;

  const anyMastered = steps.some((s) => s.mastered);

  if (anyMastered) {
    return steps.length === 1
      ? "It will also delete an action step the teacher has already MASTERED:"
      : "It will also delete its action steps — including one the teacher has already MASTERED:";
  }
  return steps.length === 1
    ? "It will also delete the action step assigned in it:"
    : `It will also delete the ${steps.length} action steps assigned in it:`;
}
