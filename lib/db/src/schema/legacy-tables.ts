/**
 * TEMPORARY — DO NOT DELETE until production has been successfully deployed.
 *
 * These definitions exist solely to prevent Replit's publish migration from
 * generating `DROP TABLE teachers/users CASCADE`, which would silently remove
 * FK constraints before the explicit DROP CONSTRAINT statements and cause the
 * migration to fail with "constraint does not exist".
 *
 * The actual cleanup is handled at server startup by migrate-to-people.ts, which
 * drops these tables once Replit's migration has already removed the legacy FK
 * columns from observations.
 *
 * After the first successful production deploy (and the startup migration has
 * run), this file and its export from index.ts can be removed.
 */
import { pgTable, serial, text, integer, boolean, date, pgEnum } from "drizzle-orm/pg-core";
import { schools } from "./schools";

export const userRoleEnum = pgEnum("user_role", ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"]);

export const teachers = pgTable("teachers", {
  id:             serial("id").primaryKey(),
  firstName:      text("first_name").notNull().default(""),
  subject:        text("subject").notNull().default(""),
  gradeLevel:     text("grade_level").array().notNull().default([]),
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
  name:     text("name").notNull().default(""),
  role:     userRoleEnum("role").notNull().default("COACH"),
  schoolId: integer("school_id").references(() => schools.id, { onDelete: "set null" }),
  googleId: text("google_id"),
  isActive: boolean("is_active").notNull().default(true),
});
