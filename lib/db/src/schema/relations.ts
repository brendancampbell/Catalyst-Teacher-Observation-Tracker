import { relations } from "drizzle-orm";
import { schools } from "./schools";
import { people } from "./people";
import { rubricSets, rubricCategories, rubricDomains } from "./rubric";
import { observations, observationScores } from "./observations";
import { chatSessions, chatMessages } from "./chat";
import { assignments } from "./assignments";
import { schoolYears } from "./school-years";
import { actionSteps } from "./action-steps";

export const schoolYearsRelations = relations(schoolYears, ({ many }) => ({
  rubricSets:   many(rubricSets),
  observations: many(observations),
  actionSteps:  many(actionSteps),
}));

export const schoolsRelations = relations(schools, ({ many }) => ({
  people:       many(people),
  observations: many(observations),
  assignments:  many(assignments),
  actionSteps:  many(actionSteps),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
  school:         one(schools, { fields: [people.schoolId], references: [schools.id] }),
  observedIn:     many(observations, { relationName: "observedPerson" }),
  observedBy:     many(observations, { relationName: "observerPerson" }),
  editedObs:      many(observations, { relationName: "editorPerson" }),
  assignments:    many(assignments),
  teachingSteps:  many(actionSteps, { relationName: "teacherSteps" }),
  assignedSteps:  many(actionSteps, { relationName: "assignerSteps" }),
  masteredSteps:  many(actionSteps, { relationName: "mastererSteps" }),
}));

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  person: one(people,  { fields: [assignments.userId],   references: [people.employeeId] }),
  school: one(schools, { fields: [assignments.schoolId], references: [schools.id] }),
}));

export const rubricSetsRelations = relations(rubricSets, ({ one, many }) => ({
  schoolYear:   one(schoolYears, { fields: [rubricSets.schoolYearId], references: [schoolYears.id] }),
  categories:   many(rubricCategories),
  observations: many(observations),
}));

export const rubricCategoriesRelations = relations(rubricCategories, ({ one, many }) => ({
  rubricSet: one(rubricSets, { fields: [rubricCategories.rubricSetId], references: [rubricSets.id] }),
  domains:   many(rubricDomains),
}));

export const rubricDomainsRelations = relations(rubricDomains, ({ one }) => ({
  category:   one(rubricCategories, { fields: [rubricDomains.categoryId],   references: [rubricCategories.id] }),
  schoolYear: one(schoolYears,      { fields: [rubricDomains.schoolYearId], references: [schoolYears.id] }),
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
  school:             one(schools,     { fields: [observations.schoolId],     references: [schools.id] }),
  schoolYear:         one(schoolYears, { fields: [observations.schoolYearId], references: [schoolYears.id] }),
  rubricSet:          one(rubricSets,  { fields: [observations.rubricSetId],  references: [rubricSets.id] }),
  scores:             many(observationScores),
  assignedSteps:      many(actionSteps, { relationName: "assignedDuringObs" }),
  masteredSteps:      many(actionSteps, { relationName: "masteredDuringObs" }),
}));

export const observationScoresRelations = relations(observationScores, ({ one }) => ({
  observation: one(observations, { fields: [observationScores.observationId], references: [observations.id] }),
}));

export const actionStepsRelations = relations(actionSteps, ({ one }) => ({
  teacher:            one(people,      { fields: [actionSteps.teacherEmployeeId],           references: [people.employeeId],      relationName: "teacherSteps" }),
  assignedBy:         one(people,      { fields: [actionSteps.assignedByEmployeeId],         references: [people.employeeId],      relationName: "assignerSteps" }),
  masteredBy:         one(people,      { fields: [actionSteps.masteredByEmployeeId],         references: [people.employeeId],      relationName: "mastererSteps" }),
  assignedDuringObs:  one(observations,{ fields: [actionSteps.assignedDuringObservationId],  references: [observations.id],        relationName: "assignedDuringObs" }),
  masteredDuringObs:  one(observations,{ fields: [actionSteps.masteredDuringObservationId],  references: [observations.id],        relationName: "masteredDuringObs" }),
  schoolYear:         one(schoolYears, { fields: [actionSteps.schoolYearId],                 references: [schoolYears.id] }),
  snapshotSchool:     one(schools,     { fields: [actionSteps.snapshotSchoolId],              references: [schools.id] }),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  person:   one(people, { fields: [chatSessions.employeeId], references: [people.employeeId] }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, { fields: [chatMessages.sessionId], references: [chatSessions.id] }),
}));
