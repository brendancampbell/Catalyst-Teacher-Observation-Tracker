-- THIS WRITES. Run against PRODUCTION.
--
-- Switches on every teacher who is ON the current roster and inactive.
--
-- If a teacher holds an open assignment in the active school year, the roster
-- says they work here. Being switched off as well is a contradiction, and the
-- consequence is that nobody can observe them. 313 at time of writing: 250 who
-- taught last year and were switched off by the flip, and 63 new hires created
-- inert by a staged upload and never switched on.
--
-- This is the same repair run on 24 Aug for the 46 staff in that state. It
-- missed every teacher, because each query in it carried `role <> 'NO_ACCESS'`
-- and a teacher IS a NO_ACCESS person.
--
-- Deliberately NOT touched: teachers with no roster row at all (89 of them).
-- Absence from the roster is how a real departure looks, and eleven of the
-- fourteen checked by hand turned out to be genuinely absent from the upload.
-- Those need a person's judgement, not a rule.
--
-- Ends with COMMIT. Change it to ROLLBACK to rehearse without saving.

BEGIN;

\echo '=== Before ==='
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT count(*) AS rostered_but_inactive
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
  JOIN assignments a
    ON a.user_id = p.employee_id AND a.school_year_id = y.incoming AND a.end_date IS NULL
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office;

\echo ''
\echo '=== Switching them on ==='
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
UPDATE people p
   SET is_active = true, updated_at = now()
  FROM y
 WHERE p.role = 'NO_ACCESS'
   AND p.is_active = false
   AND EXISTS (SELECT 1 FROM schools s
                WHERE s.id = p.school_id AND NOT s.is_home_office)
   AND EXISTS (SELECT 1 FROM assignments a
                WHERE a.user_id = p.employee_id
                  AND a.school_year_id = y.incoming
                  AND a.end_date IS NULL)
RETURNING p.employee_id, p.first_name, p.last_name, p.school_id;

\echo ''
\echo '=== After: should be zero ==='
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT count(*) AS rostered_but_inactive
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
  JOIN assignments a
    ON a.user_id = p.employee_id AND a.school_year_id = y.incoming AND a.end_date IS NULL
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office;

\echo ''
\echo '=== Left alone: inactive teachers with no roster row, by school ==='
-- Your call, one at a time. Anyone here who should be teaching needs adding to
-- a roster upload, which now switches people on by itself.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT s.display_name AS school, count(*) AS inactive_and_unrostered
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office
   AND NOT EXISTS (SELECT 1 FROM assignments a
                    WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming
                      AND a.end_date IS NULL)
 GROUP BY s.display_name
 ORDER BY inactive_and_unrostered DESC, s.display_name;

COMMIT;
