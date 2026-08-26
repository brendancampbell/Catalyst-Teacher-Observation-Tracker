-- Read-only. Run against PRODUCTION.
--
-- Following on: the roster landed 21 Aug (2464 rows) and the hand repairs ran
-- 22-25 Aug. The previous file looked for repairs more than 7 days after the
-- upload and so found none — the boundary was wrong, not the idea.
--
-- Duplicates are now effectively ruled out: one in the whole network, and it
-- reads as a real school move. So teachers were not being recreated under new
-- ids. Something else kept them off the roster.
--
-- The question this file answers: of ~370 inactive teachers, how many left,
-- and how many were dropped? Turnover every August is real, so the two have to
-- be told apart rather than assumed.

\echo '=== 1. The teachers you repaired by hand (rostered 22-25 Aug) ==='
-- A known-wrong sample. Whatever these have in common is the cause.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT s.display_name AS school,
       p.employee_id, p.first_name, p.last_name, p.email,
       a.start_date AS rostered_on,
       p.is_active,
       p.grade_level,
       p.department
  FROM people p
  CROSS JOIN y
  JOIN assignments a
    ON a.user_id = p.employee_id AND a.school_year_id = y.incoming AND a.end_date IS NULL
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS'
   AND a.start_date > DATE '2026-08-21'
 ORDER BY a.start_date, s.display_name, p.last_name;

\echo ''
\echo '=== 2. Inactive teachers: when were they last observed? ==='
-- The strongest signal available without the spreadsheets. Somebody observed
-- in the last months of the school year was plainly still teaching; somebody
-- never observed, or not since 2024, is a likelier genuine departure.
WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
),
t AS (
  SELECT p.employee_id, p.school_id,
         (SELECT max(o.date) FROM observations o
           WHERE o.observed_employee_id = p.employee_id) AS last_observed,
         (SELECT count(*) FROM observations o
           WHERE o.observed_employee_id = p.employee_id) AS observations
    FROM people p
    JOIN schools s ON s.id = p.school_id
   WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office
)
SELECT
  CASE
    WHEN observations = 0                       THEN 'never observed'
    WHEN last_observed >= DATE '2026-03-01'     THEN 'observed Mar 2026 or later'
    WHEN last_observed >= DATE '2025-09-01'     THEN 'observed during 2025-26'
    ELSE                                             'not observed since before Sep 2025'
  END AS last_seen,
  count(*) AS teachers
  FROM t
 GROUP BY 1
 ORDER BY teachers DESC;

\echo ''
\echo '=== 3. Inactive teachers WITH recent observations, by school ==='
-- The ones hardest to explain as departures: somebody was observing them
-- weeks before the rollover switched them off.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT s.display_name AS school, count(*) AS inactive_but_recently_observed
  FROM people p
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office
   AND EXISTS (SELECT 1 FROM observations o
                WHERE o.observed_employee_id = p.employee_id
                  AND o.date >= DATE '2026-03-01')
 GROUP BY s.display_name
 ORDER BY inactive_but_recently_observed DESC
 LIMIT 25;

\echo ''
\echo '=== 4. Scale check: how many people did the roster actually carry? ==='
-- 2464 assignments landed on 21 Aug. This says how that compares to the people
-- who were on last year's roster — the gap is who the flip switched off.
WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
)
SELECT
  (SELECT count(DISTINCT a.user_id) FROM assignments a CROSS JOIN y
    WHERE a.school_year_id = y.outgoing)                       AS on_last_year,
  (SELECT count(DISTINCT a.user_id) FROM assignments a CROSS JOIN y
    WHERE a.school_year_id = y.incoming)                       AS on_this_year,
  (SELECT count(*) FROM people p JOIN schools s ON s.id = p.school_id
    WHERE p.role = 'NO_ACCESS' AND NOT s.is_home_office)       AS teachers_total,
  (SELECT count(*) FROM people p JOIN schools s ON s.id = p.school_id
    WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office) AS teachers_inactive;

\echo ''
\echo '=== 5. The three still inactive at Washington Park HS ==='
-- You said every deactivated teacher there was wrong. These are what remain,
-- so you can say whether they are genuine departures or were missed.
SELECT p.employee_id, p.first_name, p.last_name, p.email,
       (SELECT max(o.date) FROM observations o
         WHERE o.observed_employee_id = p.employee_id) AS last_observed
  FROM people p
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active
   AND s.display_name IN ('NSA Washington Park HS', 'Uncommon Leadership Charter HS')
 ORDER BY s.display_name, p.last_name;
