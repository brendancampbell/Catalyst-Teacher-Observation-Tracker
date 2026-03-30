import { relations } from "drizzle-orm";
import { schools } from "./schools";
import { users } from "./users";
import { teachers } from "./teachers";
import { rubricSets, rubricCategories, rubricDomains } from "./rubric";
import { observations, observationScores } from "./observations";

export const schoolsRelations = relations(schools, ({ many }) => ({
  teachers: many(teachers),
  users:    many(users),
}));

export const teachersRelations = relations(teachers, ({ one, many }) => ({
  school:       one(schools, { fields: [teachers.schoolId], references: [schools.id] }),
  observations: many(observations),
}));

export const rubricSetsRelations = relations(rubricSets, ({ many }) => ({
  categories:   many(rubricCategories),
  observations: many(observations),
}));

export const rubricCategoriesRelations = relations(rubricCategories, ({ one, many }) => ({
  rubricSet: one(rubricSets, { fields: [rubricCategories.rubricSetId], references: [rubricSets.id] }),
  domains:   many(rubricDomains),
}));

export const rubricDomainsRelations = relations(rubricDomains, ({ one }) => ({
  category: one(rubricCategories, { fields: [rubricDomains.categoryId], references: [rubricCategories.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  school:       one(schools, { fields: [users.schoolId], references: [schools.id] }),
  observations: many(observations),
}));

export const observationsRelations = relations(observations, ({ one, many }) => ({
  teacher:   one(teachers,   { fields: [observations.teacherId],    references: [teachers.id] }),
  rubricSet: one(rubricSets, { fields: [observations.rubricSetId],  references: [rubricSets.id] }),
  observer:  one(users,      { fields: [observations.observerId],   references: [users.id] }),
  scores:    many(observationScores),
}));

export const observationScoresRelations = relations(observationScores, ({ one }) => ({
  observation: one(observations, { fields: [observationScores.observationId], references: [observations.id] }),
}));
