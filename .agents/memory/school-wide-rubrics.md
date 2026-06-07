---
name: School-Wide Rubrics Pattern
description: How TEACHER vs SCHOOL rubric targets route through the data model, API, and UI
---

## Rule
`rubricSets.target` ('TEACHER' | 'SCHOOL') controls whether a rubric set is for per-teacher observations or per-campus observations. All routing decisions flow from this single field.

**Why:** Spec called for two distinct rubric modes; we avoided a separate table by adding `target` as an enum column on `rubricSets`.

**How to apply:**
- DB: `rubric_sets.target` and `observations.target` both use the `evaluation_target` pgEnum with default `TEACHER`. `observations.teacher_id` is nullable; `observations.school_id` is nullable. SCHOOL observations: teacherId=null, schoolId=<id>.
- API `POST /observations`: if `target=SCHOOL` in body → requires NETWORK_ADMIN, requires schoolId, skips teacher scope check.
- API `GET /district/summary`: if `rubricSet.target=SCHOOL` → bypasses teacher rollup, uses most-recent school observation per campus directly.
- Frontend `DistrictDashboard`: `isSchoolTarget = data?.rubricSet?.target === 'SCHOOL'`. Hides score-type toggle; shows "Add School Observation" button (NETWORK_ADMIN only); row subLabel shows "Observed / No observation yet"; school rows are not clickable (no drilldown).
- Admin "New Rubric Set" dialog: radio group lets admin choose Teacher vs School-Wide at creation time.
- `createSchoolObservation()` in api.ts sends `{ target: 'SCHOOL', schoolId, rubricSetId, ... }` to `POST /observations`.
