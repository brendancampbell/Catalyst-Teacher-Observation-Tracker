import { pgTable, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { people } from "./people";

/**
 * Network-wide settings. Exactly one row, ever.
 *
 * Two deadlines that used to be hardcoded at 14 days in six places:
 *
 *   rescoreWindowDays  — how long a teacher has to be rescored after a
 *                        walkthrough below the proficiency threshold. Stored
 *                        on the person as a due date when they are flagged,
 *                        so changing this recalculates existing entries.
 *
 *   overdueWindowDays  — how long since a teacher's last observation before
 *                        they appear in Overdue Observations. Never stored
 *                        per person; the list is computed live, so changing
 *                        this recalculates nothing and takes effect at once.
 *
 * They are deliberately independent. They happen to share a default of 14
 * because that is what both were hardcoded to, but they answer different
 * questions — how fast must a struggling teacher be seen again, versus how
 * often should everybody be seen — and coupling them would mean changing one
 * policy silently changed the other.
 *
 * Both are stored in DAYS. The interface presents the rescore window in weeks
 * because that is how people speak about a rescore deadline; the overdue
 * window is entered as a number of days directly.
 */
export const systemSettings = pgTable("system_settings", {
  /* Always 1. The unique index below makes a second row impossible, so
     "the settings" is a single deterministic row rather than whichever one a
     query happened to return first — the same failure school_years guards
     against with its single-active index. */
  id:                integer("id").primaryKey().default(1),

  rescoreWindowDays: integer("rescore_window_days").notNull().default(14),
  overdueWindowDays: integer("overdue_window_days").notNull().default(14),

  /* Who last moved these, for the line under each control. Set null rather
     than cascade: losing the fact that a change happened would be worse than
     losing who made it, and the person may later leave. */
  rescoreUpdatedAt:  timestamp("rescore_updated_at", { withTimezone: true }),
  rescoreUpdatedBy:  text("rescore_updated_by").references(() => people.employeeId, { onDelete: "set null" }),
  overdueUpdatedAt:  timestamp("overdue_updated_at", { withTimezone: true }),
  overdueUpdatedBy:  text("overdue_updated_by").references(() => people.employeeId, { onDelete: "set null" }),

  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("system_settings_single_row_uniq")
    .on(t.id)
    .where(sql`${t.id} = 1`),
]);
