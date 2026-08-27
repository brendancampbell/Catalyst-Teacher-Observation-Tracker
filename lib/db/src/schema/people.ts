import { pgTable, text, pgEnum, integer, boolean, date, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { DEPARTMENT_VALUES, type Department } from "@workspace/api-types";
import { z } from "zod/v4";
import { schools } from "./schools";
import { schoolYears } from "./school-years";

export const personRoleEnum = pgEnum("person_role", [
  "COACH",
  "SCHOOL_LEADER",
  "NETWORK_LEADER",
  "NETWORK_ADMIN",
  "NO_ACCESS",
]);

/* Departments live in @workspace/api-types, which the apps and this package
   all depend on. Postgres builds its enum from that same list, so a
   department cannot exist in one place and not another — which is exactly
   how Spanish came to mean different things on desktop and mobile. */
export const departmentEnum = pgEnum("department_enum", DEPARTMENT_VALUES);

export { DEPARTMENT_VALUES };
export type { Department };

export const people = pgTable("people", {
  employeeId:                  text("employee_id").primaryKey(),
  firstName:                   text("first_name").notNull(),
  lastName:                    text("last_name").notNull(),
  email:                       text("email").notNull().unique(),
  googleId:                    text("google_id").unique(),
  role:                        personRoleEnum("role").notNull().default("NO_ACCESS"),
  isActive:                    boolean("is_active").notNull().default(true),
  includeInFeedbackTracker:    boolean("include_in_feedback_tracker").notNull().default(false),
  schoolId:                    integer("school_id").references(() => schools.id, { onDelete: "set null" }),
  department:                  departmentEnum("department"),
  gradeLevel:                  text("grade_level").array(),
  needsRescore:                boolean("needs_rescore").notNull().default(false),
  rescoreDueDate:              date("rescore_due_date"),
  /* The walkthrough date that put them in the rescore queue.
     The due date alone is not enough: changing the rescore window
     recalculates every existing entry, and that has to be measured from the
     observation, not from a deadline already derived under the old window.
     Null on rows flagged before this column existed — those are backfilled
     from rescore_due_date minus the previous 14-day window. */
  rescoreFromDate:             date("rescore_from_date"),
  rescoreSchoolYearId:         integer("rescore_school_year_id").references(() => schoolYears.id, { onDelete: "set null" }),
  createdAt:                   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("people_school_idx").on(t.schoolId),
  index("people_rescore_school_year_idx").on(t.rescoreSchoolYearId),
]);

export const insertPersonSchema = createInsertSchema(people).omit({ employeeId: true, createdAt: true, updatedAt: true });
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Person = typeof people.$inferSelect;

export type PersonRole = "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN" | "NO_ACCESS";
