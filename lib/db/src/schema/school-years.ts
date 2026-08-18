import { pgTable, serial, text, integer, pgEnum, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const schoolYearStatusEnum = pgEnum("school_year_status", ["active", "inactive"]);

export const schoolYears = pgTable("school_years", {
  id:           serial("id").primaryKey(),
  name:         text("name").notNull(),
  status:       schoolYearStatusEnum("status").notNull().default("inactive"),
  displayOrder: integer("display_order").notNull().default(0),
  startDate:    date("start_date"),
  endDate:      date("end_date"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /* At most one active year. getActiveSchoolYearId() takes LIMIT 1 with no
     ORDER BY, so two active rows would make "the current year" non-deterministic
     — and every observation, rubric set and action step is scoped by it.
     Safe against the activation endpoint, which deactivates all rows and then
     activates one inside a single transaction. */
  uniqueIndex("school_years_single_active_uniq")
    .on(t.status)
    .where(sql`${t.status} = 'active'`),
]);

export const insertSchoolYearSchema = createInsertSchema(schoolYears).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertSchoolYear = z.infer<typeof insertSchoolYearSchema>;
export type SchoolYear = typeof schoolYears.$inferSelect;
