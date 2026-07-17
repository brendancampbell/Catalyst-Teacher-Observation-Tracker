---
name: Observations & Action Steps School Year + Frozen Snapshots
description: Schema, migration, and creation-path details for school_year_id and frozen snapshots on observations, action steps, and the rescore queue.
---

## Rule
All new observations, action steps, and rescore queue flags must stamp:
- `schoolYearId` (from the active school year at creation time)
- `snapshotGradeSpan` (from the teacher's school's gradeSpan)
- `snapshotSchoolId` (action steps only — from teacher's people.schoolId)
- `snapshotRole` (action steps only — from teacher's role field)
- `rescoreSchoolYearId` (people table, set when needsRescore is triggered)

## Why
Historical records must never silently change when a teacher transfers schools or
their role changes. These fields are written once at creation and never updated.

## How to apply
- POST /api/observations: fetches activeYearId before both SCHOOL and TEACHER paths.
  For TEACHER target: uses `teacherSchoolId` (from db lookup on `people` by
  `resolvedObservedId`) instead of `creator.schoolId` — fixes the NETWORK_ADMIN
  null-school bug where creator.schoolId was null.
- Action step inserts (both POST and PUT /observations routes): stamp all 4 snapshot
  fields. In PUT, snapshot data is fetched from `existing.schoolId` + teacher lookup.
- Rescore trigger (POST + PUT): also stamps `rescoreSchoolYearId`; clears to null
  when rescore is cleared.

## Back-references in relations.ts
Drizzle requires bidirectional named relations. actionStepsRelations uses:
  - relationName: "teacherSteps" / "assignerSteps" / "mastererSteps" → people
  - relationName: "assignedDuringObs" / "masteredDuringObs" → observations
peopleRelations and observationsRelations must define matching `many(...)` sides.
Missing back-refs cause a 500 at runtime when any `db.query.*` with `with:` is used.

## Test files
All test files that directly insert observations or action steps must include
`schoolYearId: 1` (the active school year id in dev). 12 test files + seed-teachers.ts
were patched in migration 0003.
