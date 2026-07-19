---
name: Rubric slug endpoints need active school year filter
description: GET /:setSlug, PATCH /sets/:slug, POST /:setSlug/categories must filter by activeYearId or they silently target the oldest copy of that slug.
---

## Rule
Any `rubricSets` query that looks up by `slug` alone must also add `eq(rubricSets.schoolYearId, activeYearId)` — slugs repeat across school years via copy-forward.

**Why:** Without the year filter, `findFirst` returns the oldest row with that slug (lowest `id`). The admin page would read and write domain IDs from an old school year while the dashboard displayed domain IDs from the active school year. Descriptions saved in the admin never appeared as hover tooltips on the dashboard.

**How to apply:** Call `getActiveSchoolYearId()` at the start of the route handler and add `and(eq(rubricSets.slug, slug), eq(rubricSets.schoolYearId, activeYearId))` to every WHERE clause that previously used `eq(rubricSets.slug, slug)` alone.

Affected endpoints (fixed):
- `GET /api/rubric/:setSlug` — reads categories + domains for admin display
- `POST /api/rubric/:setSlug/categories` — adds a category to a rubric set
- `PATCH /api/rubric/sets/:slug` — rename guard lookup + update WHERE

Already correct (had year filter before this fix):
- `DELETE /api/rubric/sets/:slug`
- `GET /api/dashboard` (uses `and(eq(slug), eq(schoolYearId))`)
