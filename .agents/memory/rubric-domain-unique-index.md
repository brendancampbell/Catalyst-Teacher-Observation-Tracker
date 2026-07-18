---
name: rubric_domains unique index correction
description: The original (school_year_id, slug) unique index on rubric_domains was wrong; production had cross-rubric-set slug duplicates that crashed the backfill startup.
---

## Rule
The correct unique index for `rubric_domains` is `(school_year_id, rubric_set_id, slug)`, NOT `(school_year_id, slug)`.

**Why:** The same domain slug (e.g. "joy", "ratio_engagement") can legitimately appear in multiple rubric sets within the same school year. The original index caused a pg 23505 unique constraint violation in `ensureSchoolYearBackfill()` when trying to set `school_year_id` on all NULL rows — crashing the process before `app.listen()`.

Production had 4 slugs duplicated across rubric_set pairs: `academic_monitoring`, `joy`, `ratio_engagement`, `visual_culture`.

**How to apply:**
- Schema: `uniqueIndex("rubric_domains_year_set_slug_uniq").on(t.schoolYearId, t.rubricSetId, t.slug)` in `lib/db/src/schema/rubric.ts`
- At startup, `ensureSchoolYearBackfill()` drops the old index (if still present) and creates the new one (idempotent via `pg_indexes` check) before running the bulk UPDATE.
