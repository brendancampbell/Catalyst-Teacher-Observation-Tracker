---
name: Migration 0005 schema hardening
description: What migration 0005 does and the schema/route changes it requires
---

## What migration 0005 does
- Renames `observations.edited_at` → `observations.updated_at`
- Drops `observations.observer` (text, had default 'Principal Rivera') and `observer_email`
- Adds `observations.created_at` (NOT NULL)
- Adds `created_at` + `updated_at` to: observation_scores, schools, people, school_years, rubric_sets, rubric_categories, rubric_domains, assignments
- Adds `updated_at` to action_steps
- Adds nullable `school_number` to schools and nullable `start_date`/`end_date` to school_years
- Changes `observations.rubric_set_id` FK from CASCADE → RESTRICT
- Changes `observations.school_id` FK from CASCADE → RESTRICT
- Creates unique index on observation_scores(observation_id, domain_slug)

## Schema alignment required after migration
All timestamp/date columns above must be present in the Drizzle schema files. Zod insert schemas should `.omit({ createdAt: true, updatedAt: true })` so callers don't supply them.

`observations.updatedAt` must map to `"updated_at"` (not `"edited_at"`) in the Drizzle column definition.

## Route fix required by FK change to RESTRICT
`DELETE /api/rubric/sets/:slug` with `?force=true` must delete referencing observations inside a transaction before deleting the rubric set — the RESTRICT constraint blocks the set delete if any observations still reference it.

**Why:** CASCADE was intentional before migration 0005 but RESTRICT is the hardened behavior. The force-delete path previously relied on cascade; it now requires an explicit delete.

**How to apply:** Wrap the force-delete in `db.transaction(tx => { tx.delete(observations).where(...); tx.delete(rubricSets).where(...); })`.

## observations.time is kept as text() permanently

`observations.time` was intended to become a native PostgreSQL `time` type, but Replit's publish-time migration generator emits a bare `ALTER COLUMN ... SET DATA TYPE time` with no USING clause. PostgreSQL rejects this for text→time because the conversion needs an explicit USING expression. There is no code hook that runs before Replit's migration step.

**Resolution:** The Drizzle schema declares `time: text("time")`. Both `time()` and `text()` surface as plain JS strings, so nothing in application code changed. Production already stored this column as text, so Replit's diff sees no change and skips the migration entirely.

**Do not change this back to `time()` unless production has already been manually converted** — doing so will re-introduce the failing ALTER on every publish attempt.
