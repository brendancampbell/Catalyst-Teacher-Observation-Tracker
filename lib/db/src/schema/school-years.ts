import { pgTable, serial, text, integer, pgEnum, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const schoolYearStatusEnum = pgEnum("school_year_status", ["active", "inactive"]);

export const schoolYears = pgTable("school_years", {
  id:           serial("id").primaryKey(),
  name:         text("name").notNull(),
  status:       schoolYearStatusEnum("status").notNull().default("active"),
  displayOrder: integer("display_order").notNull().default(0),
  startDate:    date("start_date"),
  endDate:      date("end_date"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolYearSchema = createInsertSchema(schoolYears).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertSchoolYear = z.infer<typeof insertSchoolYearSchema>;
export type SchoolYear = typeof schoolYears.$inferSelect;
