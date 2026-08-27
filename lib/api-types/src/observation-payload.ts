import type {
  Score,
  CreateObservationPayload,
  UpdateObservationPayload,
} from "./index";

/**
 * What an observation is, in one place.
 *
 * Fifteen places across the two apps used to write this list out by hand, and
 * nothing made them agree. Three of them stopped sending `isWalkthrough`, so
 * saving a draft recorded the walkthrough toggle and publishing it threw the
 * toggle away. Two real walkthroughs were filed as ordinary observations
 * before anybody noticed; a third path — the Drafts page — could never save
 * the toggle at all.
 *
 * The fix is not a helper people may remember to use. Every field below is
 * REQUIRED, so a caller that has one and forgets to pass it does not compile.
 * That is the whole point: this stops the next field from going missing, not
 * just this one.
 *
 * Only the composing paths use it — filling in an observation and saving or
 * publishing it. Correcting an observation afterwards is a genuinely different
 * shape: it names the few things that changed, and may move the observation to
 * another teacher, neither of which this describes.
 */
export interface ObservationFormFields {
  teacherId:     string;
  rubricSetId:   number;
  /** ISO date, YYYY-MM-DD. */
  date:          string;
  /** HH:MM. Empty string when the observer left it blank. */
  time:          string;
  /** Empty string when not recorded. */
  course:        string;
  scores:        Record<string, Score>;
  /** HTML from the rich-text editors; empty string when untouched. */
  strengths:     string;
  growthAreas:   string;
  isWalkthrough: boolean;
}

/**
 * The action-step work that can ride along with a save.
 *
 * Genuinely optional, unlike the fields above: most saves carry none of it,
 * and the server rejects a new step and an extension together.
 */
export interface ObservationActionStepFields {
  newActionStep?:      { text: string; dueDate: string };
  masterActionStepId?: number;
  extendActionStep?:   { actionStepId: number; newDueDate: string; note?: string };
}

/** Who is filing it. Recorded on creation only; an update never restates it. */
export interface ObservationObserverFields {
  observer?:   string;
  observerId?: number;
}

export type ObservationStatus = "draft" | "published";

/**
 * Empty strings become `undefined` rather than `""`.
 *
 * The server treats a missing optional field as "leave it alone", and an empty
 * string as a value. Sending `""` for a course nobody typed would write an
 * empty course rather than no course.
 */
function orUndefined(value: string): string | undefined {
  return value.length > 0 ? value : undefined;
}

/** A brand-new observation, draft or published. */
export function observationCreatePayload(
  fields: ObservationFormFields & ObservationActionStepFields & ObservationObserverFields,
  status: ObservationStatus,
): CreateObservationPayload {
  return {
    teacherId:          fields.teacherId,
    rubricSetId:        fields.rubricSetId,
    date:               fields.date,
    time:               orUndefined(fields.time),
    course:             orUndefined(fields.course),
    scores:             fields.scores,
    strengths:          orUndefined(fields.strengths),
    growthAreas:        orUndefined(fields.growthAreas),
    isWalkthrough:      fields.isWalkthrough,
    observer:           fields.observer,
    observerId:         fields.observerId,
    status,
    newActionStep:      fields.newActionStep,
    masterActionStepId: fields.masterActionStepId,
    extendActionStep:   fields.extendActionStep,
  };
}

/**
 * An observation that already exists as a draft — saved again, or published.
 *
 * Carries the facts as well as the writing. Leaving them out was the original
 * defect: an update that names only strengths, growth areas and scores leaves
 * the walkthrough toggle, date, time and course at whatever the draft happened
 * to hold, which is not what the person on the screen just asked for.
 *
 * `null` rather than `undefined` for a cleared time or course, because here
 * the intent is "the observer removed this", which the server writes.
 */
export function observationUpdatePayload(
  fields: ObservationFormFields & ObservationActionStepFields,
  status: ObservationStatus,
): UpdateObservationPayload {
  return {
    date:               fields.date,
    time:               fields.time.length   > 0 ? fields.time   : null,
    course:             fields.course.length > 0 ? fields.course : null,
    scores:             fields.scores,
    strengths:          orUndefined(fields.strengths),
    growthAreas:        orUndefined(fields.growthAreas),
    isWalkthrough:      fields.isWalkthrough,
    status,
    newActionStep:      fields.newActionStep,
    masterActionStepId: fields.masterActionStepId,
    extendActionStep:   fields.extendActionStep,
  };
}
