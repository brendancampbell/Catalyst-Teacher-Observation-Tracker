import { relations } from "drizzle-orm";
import { users } from "./users";
import { teachers } from "./teachers";
import { rubricQuarters, rubricCategories, rubricDomains } from "./rubric";
import { observations, observationScores } from "./observations";

export const teachersRelations = relations(teachers, ({ many }) => ({
  observations: many(observations),
}));

export const rubricQuartersRelations = relations(rubricQuarters, ({ many }) => ({
  categories: many(rubricCategories),
  observations: many(observations),
}));

export const rubricCategoriesRelations = relations(rubricCategories, ({ one, many }) => ({
  quarter: one(rubricQuarters, { fields: [rubricCategories.quarterId], references: [rubricQuarters.id] }),
  domains: many(rubricDomains),
}));

export const rubricDomainsRelations = relations(rubricDomains, ({ one }) => ({
  category: one(rubricCategories, { fields: [rubricDomains.categoryId], references: [rubricCategories.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  observations: many(observations),
}));

export const observationsRelations = relations(observations, ({ one, many }) => ({
  teacher:  one(teachers, { fields: [observations.teacherId],  references: [teachers.id] }),
  quarter:  one(rubricQuarters, { fields: [observations.quarterId], references: [rubricQuarters.id] }),
  observer: one(users,    { fields: [observations.observerId], references: [users.id] }),
  scores:   many(observationScores),
}));

export const observationScoresRelations = relations(observationScores, ({ one }) => ({
  observation: one(observations, { fields: [observationScores.observationId], references: [observations.id] }),
}));
