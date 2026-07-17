import { pgTable, serial, text, integer, date, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { people, personRoleEnum } from "./people";
import { schools } from "./schools";

export const assignments = pgTable(
  "assignments",
  {
    id:        serial("id").primaryKey(),
    userId:    text("user_id").notNull().references(() => people.employeeId, { onDelete: "cascade" }),
    role:      personRoleEnum("role").notNull(),
    schoolId:  integer("school_id").references(() => schools.id, { onDelete: "set null" }),
    startDate: date("start_date").notNull(),
    endDate:   date("end_date"),
  },
  (table) => [
    uniqueIndex("assignments_user_active_uniq")
      .on(table.userId)
      .where(sql`${table.endDate} IS NULL`),
  ],
);

export const insertAssignmentSchema = createInsertSchema(assignments).omit({ id: true });
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type Assignment = typeof assignments.$inferSelect;
