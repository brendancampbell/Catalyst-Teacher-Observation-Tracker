import { pgTable, serial, text, integer, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { people } from "./people";
import { observations } from "./observations";
import { schools } from "./schools";
import { schoolYears } from "./school-years";

export const actionSteps = pgTable("action_steps", {
  id:                          serial("id").primaryKey(),
  teacherEmployeeId:           text("teacher_employee_id").notNull().references(() => people.employeeId, { onDelete: "cascade" }),
  assignedByEmployeeId:        text("assigned_by_employee_id").references(() => people.employeeId, { onDelete: "set null" }),
  assignedDuringObservationId: integer("assigned_during_observation_id").references(() => observations.id, { onDelete: "set null" }),
  text:                        text("text").notNull(),
  dueDate:                     date("due_date").notNull(),
  status:                      text("status").notNull().default("open"),
  masteredAt:                  timestamp("mastered_at", { withTimezone: true }),
  masteredByEmployeeId:        text("mastered_by_employee_id").references(() => people.employeeId, { onDelete: "set null" }),
  masteredDuringObservationId: integer("mastered_during_observation_id").references(() => observations.id, { onDelete: "set null" }),
  createdAt:                   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  schoolYearId:                integer("school_year_id").notNull().references(() => schoolYears.id),
  snapshotSchoolId:            integer("snapshot_school_id").references(() => schools.id, { onDelete: "set null" }),
  snapshotGradeSpan:           text("snapshot_grade_span"),
  snapshotRole:                text("snapshot_role"),
});

export const insertActionStepSchema = createInsertSchema(actionSteps)
  .omit({ id: true, createdAt: true })
  .refine((data) => data.status === "open" || data.status === "mastered", {
    path: ["status"],
    message: "status must be 'open' or 'mastered'",
  });

export type InsertActionStep = z.infer<typeof insertActionStepSchema>;
export type ActionStep = typeof actionSteps.$inferSelect;
