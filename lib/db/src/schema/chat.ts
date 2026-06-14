import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { people } from "./people";

export const chatSessions = pgTable("chat_sessions", {
  id:         serial("id").primaryKey(),
  employeeId: text("employee_id").notNull().references(() => people.employeeId, { onDelete: "cascade" }),
  title:      text("title").notNull().default("New Chat"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id:            serial("id").primaryKey(),
  sessionId:     integer("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role:          text("role").notNull(),
  content:       text("content").notNull(),
  rubricSetSlug: text("rubric_set_slug"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
