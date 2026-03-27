import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teachers = pgTable("teachers", {
  id:         serial("id").primaryKey(),
  name:       text("name").notNull(),
  subject:    text("subject").notNull(),
  gradeLevel: text("grade_level").array().notNull(),
});

export const insertTeacherSchema = createInsertSchema(teachers).omit({ id: true });
export type InsertTeacher = z.infer<typeof insertTeacherSchema>;
export type Teacher = typeof teachers.$inferSelect;
