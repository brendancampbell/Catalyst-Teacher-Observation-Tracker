import { pgTable, serial, text, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roleEnum = pgEnum("user_role", ["COACH", "PRINCIPAL", "DISTRICT_ADMIN"]);

export const users = pgTable("users", {
  id:    serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name:  text("name").notNull(),
  role:  roleEnum("role").notNull().default("COACH"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
