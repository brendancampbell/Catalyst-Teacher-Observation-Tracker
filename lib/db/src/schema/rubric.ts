import { pgTable, serial, text, integer, boolean, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
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
}, (t) => [
  uniqueIndex("rubric_sets_year_slug_uniq").on(t.schoolYearId, t.slug),
]);

export const rubricCategories = pgTable("rubric_categories", {
  id:           serial("id").primaryKey(),
  rubricSetId:  integer("rubric_set_id").notNull().references(() => rubricSets.id, { onDelete: "cascade" }),
  name:         text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
});

export const rubricDomains = pgTable("rubric_domains", {
  id:           serial("id").primaryKey(),
  categoryId:   integer("category_id").notNull().references(() => rubricCategories.id, { onDelete: "cascade" }),
  rubricSetId:  integer("rubric_set_id").notNull().references(() => rubricSets.id, { onDelete: "cascade" }),
  /* Denormalized from rubric_sets so we can enforce (school_year_id, slug) uniqueness
     without a join. Stamped on insert and kept in sync via copy-forward logic. */
  schoolYearId: integer("school_year_id").notNull().$type<number>().references(() => schoolYears.id),
  name:         text("name").notNull(),
  slug:         text("slug").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  description:  text("description"),
}, (t) => [
  uniqueIndex("rubric_domains_year_set_slug_uniq").on(t.schoolYearId, t.rubricSetId, t.slug),
]);

export const insertRubricSetSchema = createInsertSchema(rubricSets).omit({ id: true });
export const insertRubricCategorySchema = createInsertSchema(rubricCategories).omit({ id: true });

/* Domain slug must be lowercase letters, numbers, hyphens, and underscores.
   Accepts single-character slugs (e.g. "d") as well as multi-segment
   slugs (e.g. "my-domain-1" or "ratio_engagement"). Uppercase is rejected
   because domainSlug is matched by value in observation_scores rows.
   Underscores are allowed for backward compatibility with existing slugs. */
export const domainSlugSchema = z
  .string()
  .min(1, "slug is required")
  .regex(
    /^[a-z0-9][a-z0-9_-]*[a-z0-9]$|^[a-z0-9]$/,
    "Slug must be lowercase letters, numbers, hyphens, and underscores only (e.g. 'my-domain-1')",
  );

export const insertRubricDomainSchema = createInsertSchema(rubricDomains)
  .omit({ id: true })
  .extend({ slug: domainSlugSchema });

/* Patch schemas — partial updates that omit the FK fields callers never supply. */
export const patchRubricCategorySchema = createInsertSchema(rubricCategories)
  .omit({ id: true, rubricSetId: true })
  .partial();

export const patchRubricDomainSchema = insertRubricDomainSchema
  .omit({ categoryId: true, rubricSetId: true, schoolYearId: true })
  .partial();

/* Rubric-set slug must be uppercase letters, numbers, hyphens, and underscores. */
export const rubricSetSlugSchema = z
  .string()
  .min(1, "slug is required")
  .regex(
    /^[A-Z0-9_-]+$/,
    "Slug may only contain letters, numbers, hyphens, and underscores",
  );

/* Body schema for POST /:setSlug/categories — name must be non-empty. */
export const createRubricCategoryBodySchema = insertRubricCategorySchema
  .omit({ rubricSetId: true })
  .extend({ name: z.string().min(1, "name is required") });

/* Body schema for POST /sets — schoolYearId is optional (resolved from active year)
   and copyFromSlug is an extra convenience field not stored directly. */
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

/* Body schema for PATCH /sets/:slug — all fields optional, slug validated. */
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

/* ── Backward-compat aliases (remove after full migration) ─────── */
export const rubricQuarters = rubricSets;
export type RubricQuarter = RubricSet;
