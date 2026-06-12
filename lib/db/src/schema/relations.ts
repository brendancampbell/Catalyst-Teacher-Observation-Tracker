import { relations } from "drizzle-orm";
import { schools } from "./schools";
import { people } from "./people";
import { rubricSets, rubricCategories, rubricDomains } from "./rubric";
import { observations, observationScores } from "./observations";

export const schoolsRelations = relations(schools, ({ many }) => ({
  people:       many(people),
  observations: many(observations),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
  school:      one(schools, { fields: [people.schoolId], references: [schools.id] }),
  observedIn:  many(observations, { relationName: "observedPerson" }),
  observedBy:  many(observations, { relationName: "observerPerson" }),
  editedObs:   many(observations, { relationName: "editorPerson" }),
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

export const observationsRelations = relations(observations, ({ one, many }) => ({
  observedPerson: one(people, {
    fields:        [observations.observedEmployeeId],
    references:    [people.employeeId],
    relationName:  "observedPerson",
  }),
  observerPerson: one(people, {
    fields:        [observations.observerEmployeeId],
    references:    [people.employeeId],
    relationName:  "observerPerson",
  }),
  editorPerson: one(people, {
    fields:        [observations.editedByEmployeeId],
    references:    [people.employeeId],
    relationName:  "editorPerson",
  }),
  school:    one(schools,    { fields: [observations.schoolId],    references: [schools.id] }),
  rubricSet: one(rubricSets, { fields: [observations.rubricSetId], references: [rubricSets.id] }),
  scores:    many(observationScores),
}));

export const observationScoresRelations = relations(observationScores, ({ one }) => ({
  observation: one(observations, { fields: [observationScores.observationId], references: [observations.id] }),
}));
