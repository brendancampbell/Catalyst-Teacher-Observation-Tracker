-- Follow-up. Read-only. Run against PRODUCTION.
-- Q1 showed 36 deactivated, none with a new-year row. This asks why.

\echo '=== A. The 36, with the last year they were rostered in ==='
WITH years AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT p.employee_id, p.first_name, p.last_name, p.email, p.role,
       s.display_name AS school,
       (SELECT sy.name FROM assignments a JOIN school_years sy ON sy.id = a.school_year_id
         WHERE a.user_id = p.employee_id
         ORDER BY a.start_date DESC, a.id DESC LIMIT 1) AS last_year_rostered
  FROM people p
  CROSS JOIN years y
  LEFT JOIN schools s ON s.id = p.school_id
 WHERE NOT p.is_active
   AND p.role <> 'NO_ACCESS'
   AND NOT EXISTS (SELECT 1 FROM assignments a
                    WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming)
 ORDER BY p.last_name, p.first_name;

\echo ''
\echo '=== B. Do any of them exist TWICE — same person, new record? ==='
-- If the spreadsheet carried a different employee ID or email, the upload
-- created a fresh person and the old record was left to be deactivated.
-- A row here means the person is fine under their new record, and the old
-- one is a duplicate to retire rather than reactivate.
WITH years AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming),
dead AS (
  SELECT p.* FROM people p CROSS JOIN years y
   WHERE NOT p.is_active AND p.role <> 'NO_ACCESS'
     AND NOT EXISTS (SELECT 1 FROM assignments a
                      WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming)
)
SELECT d.employee_id AS old_id, d.email AS old_email,
       liv.employee_id AS new_id, liv.email AS new_email,
       d.first_name, d.last_name,
       liv.is_active AS new_is_active
  FROM dead d
  JOIN people liv
    ON lower(liv.first_name) = lower(d.first_name)
   AND lower(liv.last_name)  = lower(d.last_name)
   AND liv.employee_id <> d.employee_id
 ORDER BY d.last_name, d.first_name;

\echo ''
\echo '=== C. Same question by email local-part (catches a surname change) ==='
WITH years AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming),
dead AS (
  SELECT p.* FROM people p CROSS JOIN years y
   WHERE NOT p.is_active AND p.role <> 'NO_ACCESS'
     AND NOT EXISTS (SELECT 1 FROM assignments a
                      WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming)
)
SELECT d.employee_id AS old_id, d.email AS old_email,
       liv.employee_id AS new_id, liv.email AS new_email
  FROM dead d
  JOIN people liv
    ON split_part(lower(liv.email),'@',1) = split_part(lower(d.email),'@',1)
   AND liv.employee_id <> d.employee_id
 ORDER BY d.last_name, d.first_name;

\echo ''
\echo '=== D. How big was the new-year roster overall? ==='
-- Sanity check on scale: if the incoming year holds far fewer people than the
-- outgoing one did, whole sheets are missing rather than individuals failing.
SELECT sy.name, sy.status,
       count(DISTINCT a.user_id) FILTER (WHERE a.end_date IS NULL) AS open_assignments,
       count(DISTINCT a.user_id)                                   AS people_ever_rostered
  FROM school_years sy
  LEFT JOIN assignments a ON a.school_year_id = sy.id
 GROUP BY sy.id, sy.name, sy.status
 ORDER BY sy.start_date;
