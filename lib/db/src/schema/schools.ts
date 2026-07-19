import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
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
  isHomeOffice: boolean("is_home_office").notNull().default(false),
  /* Stable external identifier used for EDW/data-warehouse syncs.
     Nullable because many schools pre-date this field.               */
  schoolNumber: text("school_number").unique(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolSchema = createInsertSchema(schools, {
  displayName:  z.string().trim().min(1, "Display Name is required"),
  fullName:     z.string().trim().min(1, "Full Name is required"),
  abbreviation: z.string().trim().min(1, "Abbreviation is required"),
  region:       z.string().trim(),
  gradeSpan:    z.string().trim(),
  isHomeOffice: z.boolean().optional(),
  schoolNumber: z.string().trim().optional(),
}).omit({ id: true, createdAt: true, updatedAt: true }).superRefine((data, ctx) => {
  if (!data.isHomeOffice) {
    if (!REGIONS.includes(data.region as Region)) {
      ctx.addIssue({
        code: "custom",
        path: ["region"],
        message: `Unknown region "${data.region}" — must be one of: ${REGIONS.join(", ")}`,
      });
    }
    if (!GRADE_SPANS.includes(data.gradeSpan as GradeSpan)) {
      ctx.addIssue({
        code: "custom",
        path: ["gradeSpan"],
        message: `Unknown grade span "${data.gradeSpan}" — must be one of: ${GRADE_SPANS.join(", ")}`,
      });
    }
  }
});

export const patchSchoolSchema = createInsertSchema(schools, {
  displayName:  z.string().trim().min(1, "Display Name is required").optional(),
  fullName:     z.string().trim().min(1, "Full Name is required").optional(),
  abbreviation: z.string().trim().min(1, "Abbreviation is required").optional(),
  region:       z.string().trim().optional(),
  gradeSpan:    z.string().trim().optional(),
  isHomeOffice: z.boolean().optional(),
  schoolNumber: z.string().trim().nullable().optional(),
}).omit({ id: true, createdAt: true, updatedAt: true }).partial().superRefine((data, ctx) => {
  if (data.isHomeOffice) return;
  if (data.region !== undefined && !REGIONS.includes(data.region as Region)) {
    ctx.addIssue({
      code: "custom",
      path: ["region"],
      message: `Unknown region "${data.region}" — must be one of: ${REGIONS.join(", ")}`,
    });
  }
  if (data.gradeSpan !== undefined && !GRADE_SPANS.includes(data.gradeSpan as GradeSpan)) {
    ctx.addIssue({
      code: "custom",
      path: ["gradeSpan"],
      message: `Unknown grade span "${data.gradeSpan}" — must be one of: ${GRADE_SPANS.join(", ")}`,
    });
  }
});

export type InsertSchool = z.infer<typeof insertSchoolSchema>;
export type School = typeof schools.$inferSelect;
