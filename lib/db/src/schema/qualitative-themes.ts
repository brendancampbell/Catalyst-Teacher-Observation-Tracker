import { pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { schools } from "./schools";

export const qualitativeThemesCache = pgTable(
  "qualitative_themes_cache",
  {
    id:                   serial("id").primaryKey(),
    schoolId:             integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
    rubricSlug:           text("rubric_slug").notNull(),
    result:               jsonb("result").notNull(),
    generatedAt:          timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    obsCountAtGeneration: integer("obs_count_at_generation").notNull(),
  },
  (table) => [
    uniqueIndex("qt_cache_school_rubric_idx").on(table.schoolId, table.rubricSlug),
  ],
);
