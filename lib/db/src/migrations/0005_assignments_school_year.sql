-- ── 1. Add school_year_id column (nullable first) ────────────────────────────
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS school_year_id INTEGER REFERENCES school_years(id);

-- ── 2. Backfill: stamp every existing assignment with the active school year ──
UPDATE assignments
SET school_year_id = (
  SELECT id FROM school_years WHERE status = 'active' ORDER BY display_order DESC LIMIT 1
)
WHERE school_year_id IS NULL;

-- ── 3. Make NOT NULL now that all rows have a value ───────────────────────────
ALTER TABLE assignments ALTER COLUMN school_year_id SET NOT NULL;

-- ── 4. Drop the old single-column unique index ────────────────────────────────
DROP INDEX IF EXISTS assignments_user_active_uniq;

-- ── 5. Create new composite unique index: one active assignment per user per year
CREATE UNIQUE INDEX IF NOT EXISTS assignments_user_year_active_uniq
  ON assignments (user_id, school_year_id)
  WHERE end_date IS NULL;
