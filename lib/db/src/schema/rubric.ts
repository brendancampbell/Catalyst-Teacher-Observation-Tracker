import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rubricSets = pgTable("rubric_sets", {
  id:           serial("id").primaryKey(),
  slug:         text("slug").notNull().unique(),
  name:         text("name").notNull(),
  isActive:     boolean("is_active").notNull().default(false),
  isArchived:   boolean("is_archived").notNull().default(false),
  gradeSpan:    text("grade_span"),
  description:  text("description"),
  displayOrder: integer("display_order").notNull().default(0),
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
export const insertRubricDomainSchema = createInsertSchema(rubricDomains).omit({ id: true });

export type InsertRubricSet = z.infer<typeof insertRubricSetSchema>;
export type InsertRubricCategory = z.infer<typeof insertRubricCategorySchema>;
export type InsertRubricDomain = z.infer<typeof insertRubricDomainSchema>;
export type RubricSet = typeof rubricSets.$inferSelect;
export type RubricCategory = typeof rubricCategories.$inferSelect;
export type RubricDomain = typeof rubricDomains.$inferSelect;

/* ── Backward-compat aliases (remove after full migration) ─────── */
export const rubricQuarters = rubricSets;
export type RubricQuarter = RubricSet;
