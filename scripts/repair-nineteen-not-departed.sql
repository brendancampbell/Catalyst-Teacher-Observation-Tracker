-- THIS WRITES. Run against PRODUCTION.
--
-- The 20 people switched off with no row on the 2026-2027 roster were reviewed
-- by hand on 24 Aug 2026. Nineteen had not departed. One had:
--
--   GCMSTFI54  Geovante Crawford  - a genuine departure, deliberately NOT in
--                                   this list and left switched off.
--
-- Each id below is named explicitly rather than matched by a rule, because the
-- judgement was made person by person and the script should be auditable
-- against that. A rule would also catch Geovante.
--
-- These 19 need BOTH halves, which is what made them invisible: they are
-- switched off AND absent from the roster. The earlier repair covered people
-- missing one or the other, never both.
--
-- Ends with COMMIT. Change it to ROLLBACK to rehearse without saving.

BEGIN;

CREATE TEMP TABLE not_departed (employee_id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO not_departed (employee_id) VALUES
  ('Test123'),      -- Kizy Smith
  ('10155'),        -- Tonya Williams-Ballard
  ('EE00002335'),   -- Rachel Burks
  ('013099'),       -- James Cavanagh
  ('012890'),       -- Mallory Ernst
  ('EE00005842'),   -- Melanie Green Fox
  ('EE00001483'),   -- Schuyler Freyaldenhoven
  ('11705'),        -- Christina Fritz McMillian
  ('T7LSRYJ51'),    -- Gwendolyn Gunn-Ingram
  ('EE00005731'),   -- Amanda Henneberry
  ('013591'),       -- Hannah Herbert
  ('11157'),        -- Courtney Hovanec
  ('EE00004606'),   -- Tiffany Kipps
  ('11765'),        -- Ashemsa Lewis
  ('015476'),       -- Neha Marvania
  ('EE00002839'),   -- Nafantee Mayers
  ('EE00002458'),   -- Joy Meekins
  ('012519'),       -- Aiesha Olamiju
  ('013491');       -- Jen Petrosino

-- Refuse to run if the list is not what was reviewed, or if the one genuine
-- departure has crept into it. Better to stop than to resurrect somebody.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM not_departed;
  IF n <> 19 THEN
    RAISE EXCEPTION 'expected 19 people, got %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM not_departed WHERE employee_id = 'GCMSTFI54') THEN
    RAISE EXCEPTION 'Geovante Crawford is a real departure and must not be in this list';
  END IF;
  IF EXISTS (SELECT 1 FROM not_departed n
              LEFT JOIN people p ON p.employee_id = n.employee_id
             WHERE p.employee_id IS NULL) THEN
    RAISE EXCEPTION 'an employee id in the list does not exist';
  END IF;
END $$;

\echo '=== Switching them back on ==='
UPDATE people p
   SET is_active = true, updated_at = now()
  FROM not_departed n
 WHERE p.employee_id = n.employee_id
   AND p.is_active = false
RETURNING p.employee_id, p.first_name, p.last_name, p.role;

\echo ''
\echo '=== Putting them on this year roster ==='
-- Uses each person's own role and school, exactly as toggle-active now does.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
INSERT INTO assignments (user_id, role, school_id, school_year_id, start_date, end_date)
SELECT p.employee_id, p.role,
       COALESCE(p.school_id,
                (SELECT a.school_id FROM assignments a
                  WHERE a.user_id = p.employee_id
                  ORDER BY a.start_date DESC, a.id DESC LIMIT 1)),
       y.incoming, CURRENT_DATE, NULL
  FROM people p
  JOIN not_departed n ON n.employee_id = p.employee_id
  CROSS JOIN y
 WHERE NOT EXISTS (SELECT 1 FROM assignments a
                    WHERE a.user_id = p.employee_id
                      AND a.school_year_id = y.incoming
                      AND a.end_date IS NULL)
RETURNING user_id, role, school_id;

\echo ''
\echo '=== Confirmation: all 19 should now be active AND rostered ==='
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT p.employee_id, p.first_name, p.last_name, p.is_active,
       EXISTS (SELECT 1 FROM assignments a
                WHERE a.user_id = p.employee_id
                  AND a.school_year_id = y.incoming
                  AND a.end_date IS NULL) AS rostered
  FROM people p
  JOIN not_departed n ON n.employee_id = p.employee_id
  CROSS JOIN y
 ORDER BY p.last_name;

\echo ''
\echo '=== Geovante Crawford, untouched ==='
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT p.employee_id, p.first_name, p.last_name, p.is_active,
       EXISTS (SELECT 1 FROM assignments a
                WHERE a.user_id = p.employee_id
                  AND a.school_year_id = y.incoming
                  AND a.end_date IS NULL) AS rostered
  FROM people p CROSS JOIN y
 WHERE p.employee_id = 'GCMSTFI54';

COMMIT;
