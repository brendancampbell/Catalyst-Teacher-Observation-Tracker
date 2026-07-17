import { pgTable, serial, text, integer, date, boolean, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { people } from "./people";
import { rubricSets, evaluationTargetEnum } from "./rubric";
import { schools } from "./schools";
import { schoolYears } from "./school-years";

export const observations = pgTable("observations", {
  id:                  serial("id").primaryKey(),
  observedEmployeeId:  text("observed_employee_id").references(() => people.employeeId, { onDelete: "set null" }),
  schoolId:            integer("school_id").references(() => schools.id, { onDelete: "cascade" }),
  schoolYearId:        integer("school_year_id").notNull().references(() => schoolYears.id),
  rubricSetId:         integer("rubric_set_id").notNull().references(() => rubricSets.id, { onDelete: "cascade" }),
  observerEmployeeId:  text("observer_employee_id").references(() => people.employeeId, { onDelete: "set null" }),
  observerEmail:       text("observer_email"),
  date:                date("date").notNull(),
  course:              text("course"),
  strengths:           text("strengths"),
  growthAreas:         text("growth_areas"),
  observer:            text("observer").notNull().default("Principal Rivera"),
  time:                text("time"),
  isWalkthrough:       boolean("is_walkthrough").notNull().default(false),
  editedByEmployeeId:  text("edited_by_employee_id").references(() => people.employeeId, { onDelete: "set null" }),
  editedAt:            timestamp("edited_at", { withTimezone: true }),
  status:              text("status").notNull().default("published"),
  target:              evaluationTargetEnum("target").notNull().default("TEACHER"),
  snapshotGradeSpan:   text("snapshot_grade_span"),
});

export const observationScores = pgTable("observation_scores", {
  id:            serial("id").primaryKey(),
  observationId: integer("observation_id").notNull().references(() => observations.id, { onDelete: "cascade" }),
  domainSlug:    text("domain_slug").notNull(),
  score:         real("score").notNull(),
});

export const insertObservationSchema = createInsertSchema(observations).omit({ id: true });

/* Canonical score-value schema — score must be exactly 0, 0.5, or 1. */
export const observationScoreValueSchema = z.union([z.literal(0), z.literal(0.5), z.literal(1)]);

/* Constrained insert schema — rejects score values outside {0, 0.5, 1}. */
export const insertObservationScoreSchema = createInsertSchema(observationScores)
  .omit({ id: true })
  .refine((data) => [0, 0.5, 1].includes(data.score), {
    path: ["score"],
    message: "Score must be 0, 0.5, or 1",
  });

export type InsertObservation = z.infer<typeof insertObservationSchema>;
export type InsertObservationScore = z.infer<typeof insertObservationScoreSchema>;
export type Observation = typeof observations.$inferSelect;
export type ObservationScore = typeof observationScores.$inferSelect;
