import { pgTable, serial, text, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const schoolYearStatusEnum = pgEnum("school_year_status", ["active", "inactive"]);

export const schoolYears = pgTable("school_years", {
  id:     serial("id").primaryKey(),
  name:   text("name").notNull(),
  status: schoolYearStatusEnum("status").notNull().default("active"),
});

export const insertSchoolYearSchema = createInsertSchema(schoolYears).omit({ id: true });
export type InsertSchoolYear = z.infer<typeof insertSchoolYearSchema>;
export type SchoolYear = typeof schoolYears.$inferSelect;
