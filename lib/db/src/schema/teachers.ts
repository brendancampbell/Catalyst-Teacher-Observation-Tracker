import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teachers = pgTable("teachers", {
  id:              serial("id").primaryKey(),
  name:            text("name").notNull(),
  department:      text("department").notNull(),
  gradeLevel:      text("grade_level").notNull(),
  yearsExperience: integer("years_experience").notNull().default(0),
});

export const insertTeacherSchema = createInsertSchema(teachers).omit({ id: true });
export type InsertTeacher = z.infer<typeof insertTeacherSchema>;
export type Teacher = typeof teachers.$inferSelect;
