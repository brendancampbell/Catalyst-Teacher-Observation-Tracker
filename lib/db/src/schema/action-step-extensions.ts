import { pgTable, serial, text, integer, date, timestamp, index } from "drizzle-orm/pg-core";
import { actionSteps } from "./action-steps";
import { people } from "./people";
import { observations } from "./observations";

/**
 * One row each time an action step's due date is pushed back.
 *
 * ── Why a table rather than a counter ─────────────────────────────────────
 * "Repeat last action step" used to copy the text and due date into the new
 * action step box, so saving created a SECOND open step saying the same thing.
 * A teacher working on one thing for a term ended up with a list of identical
 * steps, and the coaching history of that one piece of work was split across
 * all of them.
 *
 * Extending the original fixes that, but on its own it would quietly erase
 * something worth knowing: that a step has been extended three times and was
 * originally due in October. That is exactly the signal a coach wants — it
 * says a teacher is stuck. So each extension is recorded rather than just
 * overwriting the date.
 *
 * The observation is recorded too, because extensions can only be made while
 * writing one. Every extension therefore has a visit behind it.
 */
export const actionStepExtensions = pgTable("action_step_extensions", {
  id:                          serial("id").primaryKey(),
  actionStepId:                integer("action_step_id").notNull().references(() => actionSteps.id, { onDelete: "cascade" }),
  /* Kept even if the person later leaves, hence set null rather than cascade —
     losing the fact that an extension happened would be worse than losing who
     made it. Matches how action_steps treats assigned_by. */
  extendedByEmployeeId:        text("extended_by_employee_id").references(() => people.employeeId, { onDelete: "set null" }),
  extendedDuringObservationId: integer("extended_during_observation_id").references(() => observations.id, { onDelete: "set null" }),
  /* Both dates, so "originally due 3 Oct" survives without replaying the chain
     and without reading action_steps.due_date as it stands now. */
  previousDueDate:             date("previous_due_date").notNull(),
  newDueDate:                  date("new_due_date").notNull(),
  /* Optional: "teacher was out two weeks". */
  note:                        text("note"),
  createdAt:                   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /* Every read is "the extensions for this step", oldest first. */
  index("action_step_extensions_step_idx").on(t.actionStepId),
]);
