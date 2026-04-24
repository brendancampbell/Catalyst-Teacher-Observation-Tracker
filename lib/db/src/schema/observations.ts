import { pgTable, serial, text, integer, date, boolean, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teachers } from "./teachers";
import { rubricSets } from "./rubric";
import { users } from "./users";

export const observations = pgTable("observations", {
  id:             serial("id").primaryKey(),
  teacherId:      integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  rubricSetId:    integer("rubric_set_id").notNull().references(() => rubricSets.id, { onDelete: "cascade" }),
  observerId:     integer("observer_id").references(() => users.id, { onDelete: "set null" }),
  date:           date("date").notNull(),
  course:         text("course"),
  strengths:      text("strengths"),
  growthAreas:    text("growth_areas"),
  observer:       text("observer").notNull().default("Principal Rivera"),
  time:           text("time"),
  isWalkthrough:  boolean("is_walkthrough").notNull().default(false),
  editedById:     integer("edited_by_id").references(() => users.id, { onDelete: "set null" }),
  editedAt:       timestamp("edited_at", { withTimezone: true }),
});

export const observationScores = pgTable("observation_scores", {
  id:            serial("id").primaryKey(),
  observationId: integer("observation_id").notNull().references(() => observations.id, { onDelete: "cascade" }),
  domainSlug:    text("domain_slug").notNull(),
  score:         real("score").notNull(),
});

export const insertObservationSchema = createInsertSchema(observations).omit({ id: true });
export const insertObservationScoreSchema = createInsertSchema(observationScores).omit({ id: true });

export type InsertObservation = z.infer<typeof insertObservationSchema>;
export type InsertObservationScore = z.infer<typeof insertObservationScoreSchema>;
export type Observation = typeof observations.$inferSelect;
export type ObservationScore = typeof observationScores.$inferSelect;
