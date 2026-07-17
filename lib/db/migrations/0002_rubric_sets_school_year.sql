-- Migration: tie rubric sets and domains to school years
-- Idempotent — safe to re-run.

-- ── 1. school_year_id on rubric_sets ────────────────────────────────
ALTER TABLE rubric_sets ADD COLUMN IF NOT EXISTS school_year_id INTEGER REFERENCES school_years(id);

UPDATE rubric_sets
SET school_year_id = (SELECT id FROM school_years WHERE status = 'active' LIMIT 1)
WHERE school_year_id IS NULL;

ALTER TABLE rubric_sets ALTER COLUMN school_year_id SET NOT NULL;

-- Drop the global slug uniqueness; replace with per-year uniqueness.
ALTER TABLE rubric_sets DROP CONSTRAINT IF EXISTS rubric_sets_slug_unique;

CREATE UNIQUE INDEX IF NOT EXISTS rubric_sets_year_slug_uniq
  ON rubric_sets (school_year_id, slug);

-- ── 2. school_year_id on rubric_domains (denormalized) ──────────────
ALTER TABLE rubric_domains ADD COLUMN IF NOT EXISTS school_year_id INTEGER REFERENCES school_years(id);

UPDATE rubric_domains d
SET school_year_id = rs.school_year_id
FROM rubric_sets rs
WHERE d.rubric_set_id = rs.id
  AND d.school_year_id IS NULL;

ALTER TABLE rubric_domains ALTER COLUMN school_year_id SET NOT NULL;

-- Replace per-rubric-set slug uniqueness with per-school-year uniqueness.
DROP INDEX IF EXISTS rubric_domains_set_slug_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS rubric_domains_year_slug_uniq
  ON rubric_domains (school_year_id, slug);
