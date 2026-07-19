import { pgTable, text, pgEnum, integer, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { schools } from "./schools";
import { schoolYears } from "./school-years";

export const personRoleEnum = pgEnum("person_role", [
  "COACH",
  "SCHOOL_LEADER",
  "NETWORK_LEADER",
  "NETWORK_ADMIN",
  "NO_ACCESS",
]);

export const departmentEnum = pgEnum("department_enum", [
  "English",
  "Math",
  "Science",
  "History",
  "Spanish",
  "Physical Education",
  "Comp Sci/Engineering",
  "Visual Arts",
  "College",
  "Other",
]);

export const DEPARTMENT_VALUES = [
  "English",
  "Math",
  "Science",
  "History",
  "Spanish",
  "Physical Education",
  "Comp Sci/Engineering",
  "Visual Arts",
  "College",
  "Other",
] as const;

export type Department = typeof DEPARTMENT_VALUES[number];

export const people = pgTable("people", {
  employeeId:                  text("employee_id").primaryKey(),
  firstName:                   text("first_name").notNull(),
  lastName:                    text("last_name").notNull(),
  email:                       text("email").notNull().unique(),
  googleId:                    text("google_id").unique(),
  role:                        personRoleEnum("role").notNull().default("NO_ACCESS"),
  isActive:                    boolean("is_active").notNull().default(true),
  includeInFeedbackTracker:    boolean("include_in_feedback_tracker").notNull().default(false),
  schoolId:                    integer("school_id").references(() => schools.id, { onDelete: "set null" }),
  department:                  departmentEnum("department"),
  /* grade_level is stored as text[] in PostgreSQL.
     For Redshift / EDW exports, serialize as a pipe-delimited string:
     e.g. gradeLevel.join("|") → "9|10|11".
     Do NOT use JSON or array syntax; Redshift COPY does not support pg arrays.
     If the field is empty, export as an empty string "".               */
  gradeLevel:                  text("grade_level").array(),
  needsRescore:                boolean("needs_rescore").notNull().default(false),
  rescoreDueDate:              date("rescore_due_date"),
  rescoreSchoolYearId:         integer("rescore_school_year_id").references(() => schoolYears.id, { onDelete: "set null" }),
  createdAt:                   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPersonSchema = createInsertSchema(people).omit({ employeeId: true });
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Person = typeof people.$inferSelect;

export type PersonRole = "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN" | "NO_ACCESS";
