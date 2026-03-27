import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rubricQuarters = pgTable("rubric_quarters", {
  id:       serial("id").primaryKey(),
  slug:     text("slug").notNull().unique(),
  name:     text("name").notNull(),
  isActive: boolean("is_active").notNull().default(false),
});

export const rubricCategories = pgTable("rubric_categories", {
  id:           serial("id").primaryKey(),
  quarterId:    integer("quarter_id").notNull().references(() => rubricQuarters.id, { onDelete: "cascade" }),
  name:         text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
});

export const rubricDomains = pgTable("rubric_domains", {
  id:           serial("id").primaryKey(),
  categoryId:   integer("category_id").notNull().references(() => rubricCategories.id, { onDelete: "cascade" }),
  name:         text("name").notNull(),
  slug:         text("slug").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
});

export const insertRubricQuarterSchema = createInsertSchema(rubricQuarters).omit({ id: true });
export const insertRubricCategorySchema = createInsertSchema(rubricCategories).omit({ id: true });
export const insertRubricDomainSchema = createInsertSchema(rubricDomains).omit({ id: true });

export type InsertRubricQuarter = z.infer<typeof insertRubricQuarterSchema>;
export type InsertRubricCategory = z.infer<typeof insertRubricCategorySchema>;
export type InsertRubricDomain = z.infer<typeof insertRubricDomainSchema>;
export type RubricQuarter = typeof rubricQuarters.$inferSelect;
export type RubricCategory = typeof rubricCategories.$inferSelect;
export type RubricDomain = typeof rubricDomains.$inferSelect;
