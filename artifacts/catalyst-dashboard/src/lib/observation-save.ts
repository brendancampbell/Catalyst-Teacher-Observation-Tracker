import {
  observationCreatePayload,
  observationUpdatePayload,
  type ObservationFormFields,
  type ObservationActionStepFields,
  type ObservationStatus,
} from "@workspace/api-types";
import { createObservation, updateObservation, type Observation } from "@/lib/api";

/**
 * Save an observation the observer is composing — the one way to do it.
 *
 * Five screens can file an observation: the dashboard, the Drafts page (twice
 * over), the Action Center and a teacher's profile. Each used to decide for
 * itself whether to create or update, and each wrote out the fields to send by
 * hand. They drifted, and three of them stopped sending the walkthrough
 * toggle.
 *
 * Two things were wrong and both are fixed here rather than in five places.
 * `ObservationFormFields` settles what an observation is made of and will not
 * compile if a field is missing. This settles the other half: whether there is
 * already a draft decides create-versus-update, and nothing else does.
 *
 * Three of those five screens ignored the draft entirely and always created.
 * The draft the form had already autosaved was left behind — a published
 * observation and an abandoned draft of it, every time.
 */
export async function saveObservation(args: {
  /** The draft the form has already autosaved, if it has. */
  draftId?:    string;
  fields:      ObservationFormFields & ObservationActionStepFields;
  /** Recorded on creation only; an update never restates who filed it. */
  observer?:   string;
  observerId?: number;
  status:      ObservationStatus;
}): Promise<Observation & { masteryWarning?: string }> {
  const { draftId, fields, observer, observerId, status } = args;

  return draftId
    ? updateObservation(draftId, observationUpdatePayload(fields, status))
    : createObservation(observationCreatePayload({ ...fields, observer, observerId }, status));
}
