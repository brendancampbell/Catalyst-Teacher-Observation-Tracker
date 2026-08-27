import {
  observationCreatePayload,
  observationUpdatePayload,
  type ObservationFormFields,
  type ObservationActionStepFields,
  type ObservationStatus,
} from "@workspace/api-types";
import { createObservation, updateObservation } from "@/lib/api";

/**
 * Save an observation the observer is composing — the one way to do it here.
 *
 * The mirror of the dashboard's helper of the same name, over the same shared
 * field list. Mobile had four places doing this by hand and every one of them
 * left out the walkthrough toggle once a draft existed, so on a phone the
 * toggle could only ever be saved by the very first autosave.
 */
export async function saveObservation(args: {
  draftId?:    string;
  fields:      ObservationFormFields & ObservationActionStepFields;
  observer?:   string;
  observerId?: number;
  status:      ObservationStatus;
}): Promise<{ id: string; masteryWarning?: string }> {
  const { draftId, fields, observer, observerId, status } = args;

  const obs = draftId
    ? await updateObservation(draftId, observationUpdatePayload(fields, status))
    : await createObservation(observationCreatePayload({ ...fields, observer, observerId }, status));

  return { id: String(obs.id), masteryWarning: obs.masteryWarning };
}
