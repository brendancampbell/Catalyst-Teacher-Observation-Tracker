import type { ObservationStepImpact } from "@/lib/api";

/**
 * The warning shown before deleting an observation that would take action
 * steps with it.
 *
 * Two cases, deliberately worded differently. An open step being deleted is a
 * retraction — the coach is taking back something they assigned. A MASTERED
 * step being deleted removes work the teacher has already done and been
 * credited for, which is a different thing to agree to, so it is named
 * explicitly rather than folded into a count.
 *
 * Steps that survive are not mentioned. Nothing is lost there, and listing
 * them would bury the part that matters.
 *
 * Pure, so the wording can be tested without a browser.
 */
export function buildObservationDeleteWarning(steps: ObservationStepImpact[]): string {
  if (steps.length === 0) {
    return "Delete this observation?\n\nThis cannot be undone.";
  }

  const mastered = steps.filter((s) => s.mastered);
  const open     = steps.filter((s) => !s.mastered);
  const list     = steps
    .map((s) => `  • ${s.text}${s.mastered ? "  (already mastered)" : ""}`)
    .join("\n");

  const lines: string[] = [];

  if (mastered.length > 0) {
    lines.push(
      steps.length === 1
        ? "Deleting this observation will also delete an action step the teacher has already MASTERED."
        : "Deleting this observation will also delete its action steps — and one the teacher has already MASTERED.",
    );
    lines.push("");
    lines.push(list);
    lines.push("");
    lines.push(
      mastered.length === 1
        ? "That completed work will disappear from their record."
        : "That completed work will disappear from their record.",
    );
  } else {
    lines.push(
      open.length === 1
        ? "Deleting this observation will also delete the action step assigned in it:"
        : `Deleting this observation will also delete the ${open.length} action steps assigned in it:`,
    );
    lines.push("");
    lines.push(list);
  }

  lines.push("");
  lines.push("This cannot be undone. Delete anyway?");
  return lines.join("\n");
}
