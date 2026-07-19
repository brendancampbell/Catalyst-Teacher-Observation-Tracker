-- Migration: DB schema hardening & cleanup
-- Adds timestamps, date fields, school_number, FK hardening,
-- removes observer/observer_email columns, changes time type to native
-- PostgreSQL TIME, adds uniqueness constraint on observation_scores,
-- renames edited_at → updated_at on observations.
--
-- Idempotent: every statement is safe to re-run on an already-migrated DB.

-- ── observations table ──────────────────────────────────────────────────────

-- Rename edited_at → updated_at (guard: only if edited_at still exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'observations' AND column_name = 'edited_at'
  ) THEN
    ALTER TABLE observations RENAME COLUMN edited_at TO updated_at;
  END IF;
END $$;

-- Add created_at (back-filled to now; historical rows will have current time)
ALTER TABLE observations ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();

-- Remove denormalized string columns — names are now derived via FK to people
ALTER TABLE observations DROP COLUMN IF EXISTS observer;
ALTER TABLE observations DROP COLUMN IF EXISTS observer_email;

-- Change `time` from free text to native PostgreSQL TIME WITHOUT TIME ZONE.
-- Values matching a valid HH:MM[:SS] pattern (hours 0-23, mins/secs 0-59) are
-- cast; any other value (AM/PM suffix, out-of-range, NULL) is coerced to NULL.
-- This is idempotent: if the column is already of type 'time', the DO block
-- exits early.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'observations'
      AND column_name = 'time'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE observations
      ALTER COLUMN "time" TYPE time USING (
        CASE
          WHEN "time" IS NULL THEN NULL
          WHEN "time" ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
            THEN "time"::time
          ELSE NULL
        END
      );
  END IF;
END $$;

-- Change school_id FK from CASCADE to RESTRICT so accidental school deletes
-- do not silently orphan observations.
ALTER TABLE observations DROP CONSTRAINT IF EXISTS observations_school_id_schools_id_fk;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'observations'
      AND constraint_name = 'observations_school_id_schools_id_fk'
  ) THEN
    ALTER TABLE observations ADD CONSTRAINT observations_school_id_schools_id_fk
      FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Change rubric_set_id FK from CASCADE to RESTRICT for the same reason.
ALTER TABLE observations DROP CONSTRAINT IF EXISTS observations_rubric_set_id_rubric_sets_id_fk;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'observations'
      AND constraint_name = 'observations_rubric_set_id_rubric_sets_id_fk'
  ) THEN
    ALTER TABLE observations ADD CONSTRAINT observations_rubric_set_id_rubric_sets_id_fk
      FOREIGN KEY (rubric_set_id) REFERENCES rubric_sets(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ── observation_scores table ─────────────────────────────────────────────────

ALTER TABLE observation_scores ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE observation_scores ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- Deduplicate scores before enforcing uniqueness: keep the most recent row
-- (highest id) per (observation_id, domain_slug). Without this step the index
-- creation fails if any duplicates exist.
DELETE FROM observation_scores
WHERE id NOT IN (
  SELECT MAX(id)
  FROM observation_scores
  GROUP BY observation_id, domain_slug
);

-- Uniqueness constraint: one score per domain per observation.
-- ON CONFLICT DO UPDATE in the application replaces any existing row.
CREATE UNIQUE INDEX IF NOT EXISTS observation_scores_obs_domain_uniq
  ON observation_scores (observation_id, domain_slug);

-- ── schools table ─────────────────────────────────────────────────────────────

ALTER TABLE schools ADD COLUMN IF NOT EXISTS school_number text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'schools' AND constraint_name = 'schools_school_number_unique'
  ) THEN
    ALTER TABLE schools ADD CONSTRAINT schools_school_number_unique UNIQUE (school_number);
  END IF;
END $$;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE schools ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- ── people table ─────────────────────────────────────────────────────────────

ALTER TABLE people ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE people ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- ── school_years table ───────────────────────────────────────────────────────

ALTER TABLE school_years ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE school_years ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE school_years ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE school_years ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- ── rubric_sets table ────────────────────────────────────────────────────────

ALTER TABLE rubric_sets ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE rubric_sets ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- ── rubric_categories table ──────────────────────────────────────────────────

ALTER TABLE rubric_categories ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE rubric_categories ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- ── rubric_domains table ─────────────────────────────────────────────────────

ALTER TABLE rubric_domains ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE rubric_domains ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- ── assignments table ────────────────────────────────────────────────────────

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- ── action_steps table ───────────────────────────────────────────────────────

ALTER TABLE action_steps ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();
