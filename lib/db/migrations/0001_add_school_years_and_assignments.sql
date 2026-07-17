-- Migration: add school_years and assignments tables
-- Generated for: Task #447 — School Year & Assignment Data Model

-- ── school_year_status enum ──────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_year_status') THEN
    CREATE TYPE school_year_status AS ENUM ('active', 'inactive');
  END IF;
END $$;

-- ── school_years table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS school_years (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  status school_year_status NOT NULL DEFAULT 'active'
);

-- Seed the initial active school year (idempotent)
INSERT INTO school_years (name, status)
SELECT '2025-2026', 'active'
WHERE NOT EXISTS (SELECT 1 FROM school_years WHERE name = '2025-2026');

-- ── assignments table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignments (
  id         SERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES people(employee_id) ON DELETE CASCADE,
  role       person_role NOT NULL,
  school_id  INTEGER REFERENCES schools(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  end_date   DATE
);

-- Partial unique index: at most one active (end_date IS NULL) assignment per user
CREATE UNIQUE INDEX IF NOT EXISTS assignments_user_active_uniq
  ON assignments (user_id)
  WHERE end_date IS NULL;
