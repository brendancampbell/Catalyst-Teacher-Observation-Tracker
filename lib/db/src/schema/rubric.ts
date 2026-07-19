import { pgTable, serial, text, integer, boolean, pgEnum, uniqueIndex, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { schoolYears } from "./school-years";

export const evaluationTargetEnum = pgEnum("evaluation_target", ["TEACHER", "SCHOOL"]);
export const subjectAudienceEnum  = pgEnum("subject_audience", ["STEM", "HUMANITIES", "ALL"]);

export const rubricSets = pgTable("rubric_sets", {
  id:              serial("id").primaryKey(),
  slug:            text("slug").notNull(),
  name:            text("name").notNull(),
  schoolYearId:    integer("school_year_id").notNull().$type<number>().references(() => schoolYears.id),
  isActive:        boolean("is_active").notNull().default(false),
  isArchived:      boolean("is_archived").notNull().default(false),
  gradeSpan:       text("grade_span"),
  description:     text("description"),
  displayOrder:    integer("display_order").notNull().default(0),
  target:          evaluationTargetEnum("target").notNull().default("TEACHER"),
  subjectAudience: subjectAudienceEnum("subject_audience").notNull().default("ALL"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("rubric_sets_year_slug_uniq").on(t.schoolYearId, t.slug),
]);

export const rubricCategories = pgTable("rubric_categories", {
  id:           serial("id").primaryKey(),
  rubricSetId:  integer("rubric_set_id").notNull().references(() => rubricSets.id, { onDelete: "cascade" }),
  name:         text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rubricDomains = pgTable("rubric_domains", {
  id:           serial("id").primaryKey(),
  categoryId:   integer("category_id").notNull().references(() => rubricCategories.id, { onDelete: "cascade" }),
  rubricSetId:  integer("rubric_set_id").notNull().references(() => rubricSets.id, { onDelete: "cascade" }),
  schoolYearId: integer("school_year_id").notNull().$type<number>().references(() => schoolYears.id),
  name:         text("name").notNull(),
  slug:         text("slug").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  description:  text("description"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("rubric_domains_year_set_slug_uniq").on(t.schoolYearId, t.rubricSetId, t.slug),
]);

export const insertRubricSetSchema = createInsertSchema(rubricSets).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRubricCategorySchema = createInsertSchema(rubricCategories).omit({ id: true, createdAt: true, updatedAt: true });

export const domainSlugSchema = z
  .string()
  .min(1, "slug is required")
  .regex(
    /^[a-z0-9][a-z0-9_-]*[a-z0-9]$|^[a-z0-9]$/,
    "Slug must be lowercase letters, numbers, hyphens, and underscores only (e.g. 'my-domain-1')",
  );

export const insertRubricDomainSchema = createInsertSchema(rubricDomains)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ slug: domainSlugSchema });

export const patchRubricCategorySchema = createInsertSchema(rubricCategories)
  .omit({ id: true, rubricSetId: true, createdAt: true, updatedAt: true })
  .partial();

export const patchRubricDomainSchema = insertRubricDomainSchema
  .omit({ categoryId: true, rubricSetId: true, schoolYearId: true })
  .partial();

export const rubricSetSlugSchema = z
  .string()
  .min(1, "slug is required")
  .regex(
    /^[A-Z0-9_-]+$/,
    "Slug may only contain letters, numbers, hyphens, and underscores",
  );

export const createRubricCategoryBodySchema = insertRubricCategorySchema
  .omit({ rubricSetId: true })
  .extend({ name: z.string().min(1, "name is required") });

export const createRubricSetBodySchema = z.object({
  slug:            rubricSetSlugSchema,
  name:            z.string().min(1, "name is required"),
  gradeSpan:       z.string().optional(),
  description:     z.string().optional(),
  target:          z.enum(["TEACHER", "SCHOOL"]).optional(),
  subjectAudience: z.enum(["STEM", "HUMANITIES", "ALL"]).optional(),
  schoolYearId:    z.number().int().optional(),
  copyFromSlug:    z.string().optional(),
});

export const patchRubricSetSchema = z.object({
  name:            z.string().min(1).optional(),
  slug:            rubricSetSlugSchema.optional(),
  description:     z.string().optional(),
  isArchived:      z.boolean().optional(),
  gradeSpan:       z.string().nullable().optional(),
  target:          z.enum(["TEACHER", "SCHOOL"]).optional(),
  subjectAudience: z.enum(["STEM", "HUMANITIES", "ALL"]).optional(),
});

export type InsertRubricSet = z.infer<typeof insertRubricSetSchema>;
export type InsertRubricCategory = z.infer<typeof insertRubricCategorySchema>;
export type InsertRubricDomain = z.infer<typeof insertRubricDomainSchema>;
export type RubricSet = typeof rubricSets.$inferSelect;
export type RubricCategory = typeof rubricCategories.$inferSelect;
export type RubricDomain = typeof rubricDomains.$inferSelect;

export type SubjectAudience = "STEM" | "HUMANITIES" | "ALL";

export const rubricQuarters = rubricSets;
export type RubricQuarter = RubricSet;
