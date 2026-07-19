import { pgTable, serial, text, integer, date, uniqueIndex, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { people, personRoleEnum } from "./people";
import { schools } from "./schools";
import { schoolYears } from "./school-years";

export const assignments = pgTable(
  "assignments",
  {
    id:           serial("id").primaryKey(),
    userId:       text("user_id").notNull().references(() => people.employeeId, { onDelete: "cascade" }),
    role:         personRoleEnum("role").notNull(),
    schoolId:     integer("school_id").references(() => schools.id, { onDelete: "set null" }),
    schoolYearId: integer("school_year_id").notNull().references(() => schoolYears.id),
    startDate:    date("start_date").notNull(),
    endDate:      date("end_date"),
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("assignments_user_year_active_uniq")
      .on(table.userId, table.schoolYearId)
      .where(sql`${table.endDate} IS NULL`),
  ],
);

export const insertAssignmentSchema = createInsertSchema(assignments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type Assignment = typeof assignments.$inferSelect;
