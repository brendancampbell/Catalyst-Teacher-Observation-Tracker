import { pgTable, serial, text, pgEnum, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { schools } from "./schools";

export const roleEnum = pgEnum("user_role", ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"]);

export const users = pgTable("users", {
  id:       serial("id").primaryKey(),
  email:    text("email").notNull().unique(),
  name:     text("name").notNull(),
  role:     roleEnum("role").notNull().default("COACH"),
  schoolId: integer("school_id").references(() => schools.id, { onDelete: "set null" }),
  googleId: text("google_id"),
  isActive: boolean("is_active").notNull().default(true),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
