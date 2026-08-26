-- Read-only. Run against PRODUCTION.
--
-- What the three actually showed:
--
--   * all three WERE carried by the upload — each has a 2026-2027 roster row
--     written 21 Aug. The upload skipped nobody.
--   * Allen and Chen have no 2025-2026 assignment at all. They are new hires,
--     created 21 Aug, so the flip cannot have deactivated them — it never
--     considered them. They were rostered and inactive from the start.
--
-- A staged upload creates a new hire INERT (is_active false) on purpose, so
-- nothing takes effect before the year is activated. Activation is then meant
-- to switch them on. These were not switched on.
--
-- The repair on 24 Aug could not have caught them: every query in it carried
-- `role <> 'NO_ACCESS'`, and a teacher IS a NO_ACCESS person. This finds the
-- whole group properly.

\echo '=== 1. When was the year activated, and when were they created? ==='
-- If people were created AFTER activation, a staged upload was still running
-- against a year that had already flipped, and nothing would ever switch them
-- on. If before, activation should have caught them and did not.
SELECT name, status, start_date, updated_at AS status_last_changed
  FROM school_years
 ORDER BY start_date;

\echo ''
\echo '=== 2. Exactly when each assignment row was written ==='
SELECT p.last_name, sy.name AS school_year,
       a.start_date, a.end_date, a.created_at AS row_written_at,
       pe.created_at AS person_created_at
  FROM assignments a
  JOIN people p        ON p.employee_id = a.user_id
  JOIN people pe       ON pe.employee_id = a.user_id
  JOIN school_years sy ON sy.id = a.school_year_id
 WHERE a.user_id IN ('EE00006077','EE00006228','EE00004396')
 ORDER BY p.last_name, a.created_at;

\echo ''
\echo '=== 3. THE LIST: teachers who are rostered this year but switched off ==='
-- The teacher equivalent of the 46. Every one of these is on the current
-- roster and cannot be observed. This is the repair list.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT s.display_name AS school, count(*) AS rostered_but_inactive
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
  JOIN assignments a
    ON a.user_id = p.employee_id AND a.school_year_id = y.incoming AND a.end_date IS NULL
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office
 GROUP BY s.display_name
 ORDER BY rostered_but_inactive DESC, s.display_name;

\echo ''
\echo '=== 4. The same, totalled, and split by whether they are new hires ==='
-- A new hire (no last-year row) was created inert and never switched on.
-- Somebody WITH a last-year row was switched off by the flip and never
-- switched back. Two causes, both ending in a teacher nobody can observe.
WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
)
SELECT
  EXISTS (SELECT 1 FROM assignments a2
           WHERE a2.user_id = p.employee_id AND a2.school_year_id = y.outgoing) AS was_here_last_year,
  count(*) AS teachers
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
  JOIN assignments a
    ON a.user_id = p.employee_id AND a.school_year_id = y.incoming AND a.end_date IS NULL
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office
 GROUP BY 1
 ORDER BY 2 DESC;

\echo ''
\echo '=== 5. And the other half: teachers NOT on this year roster at all ==='
-- Separate problem, separate fix. These need to be on a roster upload, which
-- now switches people on by itself.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT count(*) AS inactive_and_unrostered
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office
   AND NOT EXISTS (SELECT 1 FROM assignments a
                    WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming
                      AND a.end_date IS NULL);
