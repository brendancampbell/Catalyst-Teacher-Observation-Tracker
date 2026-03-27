import { pgTable, serial, text, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teachers } from "./teachers";
import { rubricQuarters } from "./rubric";
import { users } from "./users";

export const observations = pgTable("observations", {
  id:          serial("id").primaryKey(),
  teacherId:   integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  quarterId:   integer("quarter_id").notNull().references(() => rubricQuarters.id, { onDelete: "cascade" }),
  observerId:  integer("observer_id").references(() => users.id, { onDelete: "set null" }),
  date:        date("date").notNull(),
  strengths:   text("strengths"),
  growthAreas: text("growth_areas"),
  observer:    text("observer").notNull().default("Principal Rivera"),
});

export const observationScores = pgTable("observation_scores", {
  id:            serial("id").primaryKey(),
  observationId: integer("observation_id").notNull().references(() => observations.id, { onDelete: "cascade" }),
  domainSlug:    text("domain_slug").notNull(),
  score:         integer("score").notNull(),
});

export const insertObservationSchema = createInsertSchema(observations).omit({ id: true });
export const insertObservationScoreSchema = createInsertSchema(observationScores).omit({ id: true });

export type InsertObservation = z.infer<typeof insertObservationSchema>;
export type InsertObservationScore = z.infer<typeof insertObservationScoreSchema>;
export type Observation = typeof observations.$inferSelect;
export type ObservationScore = typeof observationScores.$inferSelect;
