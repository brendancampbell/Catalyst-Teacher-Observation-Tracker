/**
 * Legacy table definitions kept in the Drizzle schema so that Replit's
 * publish migration does NOT generate `DROP TABLE teachers/users CASCADE`.
 * Those tables are instead cleaned up at server startup by migrate-to-people.ts.
 *
 * Once the first successful production deploy has completed (and the startup
 * migration has dropped these tables from production), this file and its
 * exports from index.ts can be removed.
 */
import { pgTable, serial, text, integer, boolean, date, pgEnum } from "drizzle-orm/pg-core";
import { schools } from "./schools";

export const userRoleEnum = pgEnum("user_role", ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"]);

export const teachers = pgTable("teachers", {
  id:             serial("id").primaryKey(),
  firstName:      text("first_name").notNull().default(""),
  subject:        text("subject").notNull(),
  gradeLevel:     text("grade_level").array().notNull(),
  isActive:       boolean("is_active").notNull().default(true),
  schoolId:       integer("school_id").references(() => schools.id, { onDelete: "set null" }),
  needsRescore:   boolean("needs_rescore").notNull().default(false),
  rescoreDueDate: date("rescore_due_date"),
  email:          text("email"),
  lastName:       text("last_name").notNull().default(""),
  employeeId:     text("employee_id"),
});

export const legacyUsers = pgTable("users", {
  id:       serial("id").primaryKey(),
  email:    text("email").notNull(),
  name:     text("name").notNull(),
  role:     userRoleEnum("role").notNull().default("COACH"),
  schoolId: integer("school_id").references(() => schools.id, { onDelete: "set null" }),
  googleId: text("google_id"),
  isActive: boolean("is_active").notNull().default(true),
});
