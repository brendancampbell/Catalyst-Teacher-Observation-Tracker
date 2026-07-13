import { pgTable, serial, text, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const evaluationTargetEnum = pgEnum("evaluation_target", ["TEACHER", "SCHOOL"]);
export const subjectAudienceEnum  = pgEnum("subject_audience", ["STEM", "HUMANITIES", "ALL"]);

export const rubricSets = pgTable("rubric_sets", {
  id:              serial("id").primaryKey(),
  slug:            text("slug").notNull().unique(),
  name:            text("name").notNull(),
  isActive:        boolean("is_active").notNull().default(false),
  isArchived:      boolean("is_archived").notNull().default(false),
  gradeSpan:       text("grade_span"),
  description:     text("description"),
  displayOrder:    integer("display_order").notNull().default(0),
  target:          evaluationTargetEnum("target").notNull().default("TEACHER"),
  subjectAudience: subjectAudienceEnum("subject_audience").notNull().default("ALL"),
});

export const rubricCategories = pgTable("rubric_categories", {
  id:           serial("id").primaryKey(),
  rubricSetId:  integer("rubric_set_id").notNull().references(() => rubricSets.id, { onDelete: "cascade" }),
  name:         text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
});

export const rubricDomains = pgTable("rubric_domains", {
  id:           serial("id").primaryKey(),
  categoryId:   integer("category_id").notNull().references(() => rubricCategories.id, { onDelete: "cascade" }),
  name:         text("name").notNull(),
  slug:         text("slug").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  description:  text("description"),
});

export const insertRubricSetSchema = createInsertSchema(rubricSets).omit({ id: true });
export const insertRubricCategorySchema = createInsertSchema(rubricCategories).omit({ id: true });

/* Domain slug must be lowercase letters, numbers, and hyphens.
   Accepts single-character slugs (e.g. "d") as well as multi-segment
   slugs (e.g. "my-domain-1"). Uppercase and underscores are rejected
   because domainSlug is matched by value in observation_scores rows. */
export const domainSlugSchema = z
  .string()
  .min(1, "slug is required")
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
    "Slug must be lowercase letters, numbers, and hyphens only (e.g. 'my-domain-1')",
  );

export const insertRubricDomainSchema = createInsertSchema(rubricDomains)
  .omit({ id: true })
  .extend({ slug: domainSlugSchema });

/* Patch schemas — partial updates that omit the FK fields callers never supply. */
export const patchRubricCategorySchema = createInsertSchema(rubricCategories)
  .omit({ id: true, rubricSetId: true })
  .partial();

export const patchRubricDomainSchema = insertRubricDomainSchema
  .omit({ categoryId: true })
  .partial();

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
