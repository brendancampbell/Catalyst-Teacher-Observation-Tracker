---
name: Rubric slug year filter
description: getRubricSetId and all slug-based rubric lookups must filter by the active school year to avoid returning stale/old-year copies
---

## Rule
Any function that resolves a rubric set ID from a slug must AND with `school_year_id = activeYearId`. A bare `WHERE slug = $1 LIMIT 1` returns the row with the lowest `id`, which is always the oldest school year's copy.

**Why:** rubric_sets are copied year-over-year with the same slug (e.g. "Q1" exists as id=3 in 2025-2026 and id=28 in 2026-2027). Without a year filter, every function that looks up by slug silently operates on the inactive year's copy, causing zero-result joins for any data that exists only in the active year.

**How to apply:** `getRubricSetId(slug, schoolYearId?)` in `ai.ts` — call `getActiveSchoolYearId()` first, then pass it as the second argument. All 4 callers in the ai router follow this pattern. Any new slug-based rubric lookup added anywhere must apply the same pattern.
