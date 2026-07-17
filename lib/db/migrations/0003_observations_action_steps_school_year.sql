-- ── 1. observations: school_year_id ──────────────────────────────────
ALTER TABLE observations ADD COLUMN IF NOT EXISTS school_year_id INTEGER REFERENCES school_years(id);
UPDATE observations
  SET school_year_id = (SELECT id FROM school_years WHERE status = 'active' LIMIT 1)
  WHERE school_year_id IS NULL;
ALTER TABLE observations ALTER COLUMN school_year_id SET NOT NULL;

-- ── 2. observations: snapshot_grade_span ─────────────────────────────
ALTER TABLE observations ADD COLUMN IF NOT EXISTS snapshot_grade_span TEXT;
UPDATE observations o
  SET snapshot_grade_span = s.grade_span
  FROM schools s
  WHERE o.school_id = s.id AND o.snapshot_grade_span IS NULL;

-- ── 3. action_steps: school_year_id ──────────────────────────────────
ALTER TABLE action_steps ADD COLUMN IF NOT EXISTS school_year_id INTEGER REFERENCES school_years(id);
UPDATE action_steps
  SET school_year_id = (SELECT id FROM school_years WHERE status = 'active' LIMIT 1)
  WHERE school_year_id IS NULL;
ALTER TABLE action_steps ALTER COLUMN school_year_id SET NOT NULL;

-- ── 4. action_steps: snapshot_school_id ──────────────────────────────
ALTER TABLE action_steps ADD COLUMN IF NOT EXISTS snapshot_school_id INTEGER REFERENCES schools(id);
UPDATE action_steps a
  SET snapshot_school_id = p.school_id
  FROM people p
  WHERE a.teacher_employee_id = p.employee_id AND a.snapshot_school_id IS NULL;

-- ── 5. action_steps: snapshot_grade_span ─────────────────────────────
ALTER TABLE action_steps ADD COLUMN IF NOT EXISTS snapshot_grade_span TEXT;
UPDATE action_steps a
  SET snapshot_grade_span = s.grade_span
  FROM schools s
  WHERE a.snapshot_school_id = s.id AND a.snapshot_grade_span IS NULL;

-- ── 6. action_steps: snapshot_role ───────────────────────────────────
ALTER TABLE action_steps ADD COLUMN IF NOT EXISTS snapshot_role TEXT;
UPDATE action_steps a
  SET snapshot_role = p.role
  FROM people p
  WHERE a.teacher_employee_id = p.employee_id AND a.snapshot_role IS NULL;

-- ── 7. people: rescore_school_year_id ────────────────────────────────
ALTER TABLE people ADD COLUMN IF NOT EXISTS rescore_school_year_id INTEGER REFERENCES school_years(id);
UPDATE people
  SET rescore_school_year_id = (SELECT id FROM school_years WHERE status = 'active' LIMIT 1)
  WHERE needs_rescore = true AND rescore_school_year_id IS NULL;
