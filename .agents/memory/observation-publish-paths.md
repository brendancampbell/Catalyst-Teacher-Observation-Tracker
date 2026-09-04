# Every publish path must invalidate the same caches — and how to date a publish

Two things worth keeping from the 3–4 Sep 2026 investigation into an observation
that saved correctly and did not appear on the teacher's profile.

## The bug: a second publish path that refreshed less

An observation can be published from two places, and they did not agree about
what to refresh afterwards:

- `Dashboard.handleNewObservation` invalidated `dashboard`, `latestActionSteps`
  and `actionSteps/<teacherId>`.
- `DraftsModal.handleSubmitResumed` invalidated **only** `myDrafts`.

So a draft published from **My Drafts** left the drafts list correct and every
other screen stale. The teacher profile reads `teacher.observations` out of the
dashboard payload — it does not fetch per-teacher — so the observation was
absent there until something else happened to refetch. The toast still said
"Observation submitted!", which is why it read as a save that had failed rather
than a screen that had not caught up.

Fixed on branch `fix-drafts-publish-refresh` by giving both paths the same three
keys, with `DraftsModal.publishInvalidation.test.tsx` pinning it.

**How to apply:** any new route to publishing, deleting or reassigning an
observation has to invalidate the same set. The teacher profile has no query of
its own, so "the profile did not update" is always about the *dashboard* key.

## The forensics: dating a publish from the database

There is no status history on `observations`, so none of these are obvious:

- **`updated_at` is NULL after publishing your own draft.** `isDraftAutosave` in
  `routes/observations.ts` is `existing.status === "draft" && isOwnObservation`,
  evaluated *before* the write — so a publish of your own draft looks like an
  autosave and skips the audit stamp. A non-NULL `updated_at` therefore means an
  edit to an *already published* row, or a change by somebody else. It does not
  mean "this was published then".
- **`action_steps.created_at` IS the publish moment.** A step is only ever
  written when an observation is published, and carries
  `assigned_during_observation_id`. This is the only reliable timestamp for when
  an observation went live. It is what settled the case: created 09:53, action
  step at 10:21, so it was a draft for 28 minutes and published 8 minutes before
  the user reported it missing.
- **`created_at` is when the draft was first autosaved**, not when it was filed.

## What was ruled out, so it need not be re-derived

Every server-side cache is a 2-minute hard expiry (`TtlCache`, not sliding) and
is cleared on every observation write; the dashboard one only applies to
network-wide (`schoolId=null`) requests at all. `getActiveSchoolYearId` caches
for 60s. There is no HTTP caching on `/api/dashboard`, no service worker, and no
scheduled job. **Nothing in the read path can hold data back for hours** — so a
multi-hour delay is never a cache, and chasing one wastes the investigation.

Also checked and clean: `rubric_set_id` vs `school_year_id` mismatch (the
[[rubric-slug-year-filter]] class — zero rows network-wide), observation
`school_id` stamping, and `is_walkthrough` filtering via the `?view=` URL
parameter. That last one remains a live trap: the teacher profile inherits the
dashboard's walkthrough filter with nothing on screen saying so.

Related: [[teacher-profile-deep-link]], [[rubric-slug-year-filter]].
