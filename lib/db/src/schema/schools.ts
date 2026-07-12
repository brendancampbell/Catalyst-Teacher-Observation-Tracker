import { pgTable, serial, text, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const REGIONS = ["Boston", "Camden", "NYC", "Newark", "Rochester"] as const;
export type Region = typeof REGIONS[number];

export const GRADE_SPANS = ["ES", "MS", "HS"] as const;
export type GradeSpan = typeof GRADE_SPANS[number];

export const schools = pgTable("schools", {
  id:           serial("id").primaryKey(),
  displayName:  text("display_name").notNull(),
  fullName:     text("full_name").notNull(),
  abbreviation: text("abbreviation").notNull().unique(),
  region:       text("region").notNull(),
  gradeSpan:    text("grade_span").notNull(),
  isActive:     boolean("is_active").notNull().default(true),
  isArchived:   boolean("is_archived").notNull().default(false),
});

export const insertSchoolSchema = createInsertSchema(schools, {
  displayName:  z.string().trim().min(1, "Display Name is required"),
  fullName:     z.string().trim().min(1, "Full Name is required"),
  abbreviation: z.string().trim().min(1, "Abbreviation is required"),
  region:       z.string().trim().pipe(
    z.enum(REGIONS, {
      error: (iss) => ({
        message: `Unknown region "${iss.input}" — must be one of: ${REGIONS.join(", ")}`,
      }),
    })
  ),
  gradeSpan:    z.string().trim().pipe(
    z.enum(GRADE_SPANS, {
      error: (iss) => ({
        message: `Unknown grade span "${iss.input}" — must be one of: ${GRADE_SPANS.join(", ")}`,
      }),
    })
  ),
}).omit({ id: true });

export const patchSchoolSchema = insertSchoolSchema.partial();

export type InsertSchool = z.infer<typeof insertSchoolSchema>;
export type School = typeof schools.$inferSelect;
