---
name: Assignments school-year scoping
description: How school_year_id on assignments gates user access year-over-year, including the activeThisYear check nuance
---

## Rule
`assignments.school_year_id` (NOT NULL) scopes each assignment to a school year.
The composite partial unique index `assignments_user_year_active_uniq` on
`(user_id, school_year_id) WHERE end_date IS NULL` enforces one active assignment
per user per year.

Bulk upload (`POST /api/people/bulk`) resolves the active school year once at the
top of the handler and stamps every new/reopened assignment with it. The existing-
assignment lookup also filters by `schoolYearId` so re-uploading a user in a new
year creates a fresh assignment rather than a no-op.

## activeThisYear check in passport.ts

`checkActiveThisYear(employeeId)` returns `false` only when:
1. An active school year exists AND
2. The user has **at least one** assignment row in the DB (i.e. has been through
   the onboarding/upload flow before) AND
3. None of those assignments are open (`end_date IS NULL`) in the active year.

Users with **no assignment rows at all** return `true` — they are treated as
brand-new/not-yet-scoped, not as inactive. This is essential so test suites that
seed temp `people` rows directly via `db.insert(people)` (without a companion
assignment) are not blocked.

**Why:** The "not active this year" block targets users who *were* active in a prior
year but haven't been re-uploaded for the current year — not freshly seeded accounts
or integration-test fixtures.

## How to apply
- When writing integration tests that create temp users, there is no need to also
  insert an assignment unless the test specifically needs to exercise the year-
  scoping logic.
- If a new test *does* need to verify activeThisYear behaviour, insert at least one
  historical assignment first so the guard activates, then check current-year access.
- The 403 response includes `code: "NOT_ACTIVE_THIS_YEAR"` — frontends should
  detect this code and show a friendly message rather than redirecting to login.
