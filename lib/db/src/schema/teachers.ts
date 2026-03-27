import { pgTable, serial, text, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { schools } from "./schools";

export const teachers = pgTable("teachers", {
  id:         serial("id").primaryKey(),
  name:       text("name").notNull(),
  subject:    text("subject").notNull(),
  gradeLevel: text("grade_level").array().notNull(),
  isActive:   boolean("is_active").notNull().default(true),
  schoolId:   integer("school_id").references(() => schools.id, { onDelete: "set null" }),
});

export const insertTeacherSchema = createInsertSchema(teachers).omit({ id: true });
export type InsertTeacher = z.infer<typeof insertTeacherSchema>;
export type Teacher = typeof teachers.$inferSelect;
