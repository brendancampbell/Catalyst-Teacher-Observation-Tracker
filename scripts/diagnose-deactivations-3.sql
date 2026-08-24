-- Read-only. Run against PRODUCTION.
-- Characterises the two groups production actually has:
--   46 rostered but deactivated, and 19 active but unable to sign in.

\echo '=== A. The 46: is their new-year assignment open or closed? ==='
-- Query 3 did not filter on end_date. This splits it, because the two mean
-- very different things. OPEN + inactive means they were rostered and simply
-- never switched back on. CLOSED means something end-dated them afterwards.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT
  CASE WHEN a.end_date IS NULL THEN 'open' ELSE 'closed' END AS assignment_state,
  p.role,
  count(*) AS people
  FROM people p
  CROSS JOIN y
  JOIN assignments a ON a.user_id = p.employee_id AND a.school_year_id = y.incoming
 WHERE NOT p.is_active AND p.role <> 'NO_ACCESS'
 GROUP BY 1, 2
 ORDER BY 1, 3 DESC;

\echo ''
\echo '=== B. The 46: when did that assignment start, relative to the flip? ==='
-- If the assignment starts AFTER the year was activated, they were rostered
-- late — deactivated by the flip, then uploaded back on, with nothing to turn
-- them active again. A roster upload never sets is_active.
WITH y AS (
  SELECT id AS incoming, activated_at
    FROM school_years WHERE status='active'
)
SELECT a.start_date,
       count(*) AS people,
       min(y.activated_at::date) AS year_activated
  FROM people p
  CROSS JOIN y
  JOIN assignments a ON a.user_id = p.employee_id AND a.school_year_id = y.incoming
 WHERE NOT p.is_active AND p.role <> 'NO_ACCESS'
 GROUP BY a.start_date
 ORDER BY a.start_date;

\echo ''
\echo '=== C. The 19 who cannot sign in: what does their history look like? ==='
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT p.employee_id, p.first_name, p.last_name, p.role,
       (SELECT count(*) FROM assignments a
         WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming) AS rows_this_year,
       (SELECT max(a.end_date) FROM assignments a
         WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming) AS closed_on,
       (SELECT sy.name FROM assignments a JOIN school_years sy ON sy.id=a.school_year_id
         WHERE a.user_id = p.employee_id
         ORDER BY a.start_date DESC, a.id DESC LIMIT 1) AS latest_year
  FROM people p
  CROSS JOIN y
 WHERE p.is_active
   AND p.role NOT IN ('NO_ACCESS','NETWORK_ADMIN')
   AND EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = p.employee_id)
   AND NOT EXISTS (SELECT 1 FROM assignments a
                    WHERE a.user_id = p.employee_id
                      AND a.school_year_id = y.incoming
                      AND a.end_date IS NULL)
 ORDER BY p.last_name;
