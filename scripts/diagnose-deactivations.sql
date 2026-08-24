-- Run against PRODUCTION. Read-only: nothing here writes.
--
-- Question 1 settles the cause. Questions 2-4 measure the damage either way.

\echo '=== 1. Does the stale index exist here? ==='
-- If assignments_user_active_uniq appears, that is the cause: it permits one
-- open assignment per person across ALL years, so every returning staff
-- member's new-year row was rejected and logged as "skipped — Duplicate email
-- or employee ID" during the roster upload.
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE tablename = 'assignments'
   AND indexname LIKE '%active%';

\echo ''
\echo '=== 2. How many were deactivated at the flip, and do they have a new-year row? ==='
WITH years AS (
  SELECT
    (SELECT id FROM school_years WHERE status = 'active') AS incoming,
    (SELECT id FROM school_years WHERE status <> 'active'
      ORDER BY start_date DESC LIMIT 1)                   AS outgoing
)
SELECT
  count(*) FILTER (WHERE NOT p.is_active)                        AS inactive_people,
  count(*) FILTER (WHERE NOT p.is_active AND inc.user_id IS NULL) AS inactive_no_incoming_row,
  count(*) FILTER (WHERE NOT p.is_active AND inc.user_id IS NOT NULL) AS inactive_but_rostered
  FROM people p
  CROSS JOIN years y
  LEFT JOIN LATERAL (
    SELECT a.user_id FROM assignments a
     WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming
     LIMIT 1
  ) inc ON true
 WHERE p.role <> 'NO_ACCESS';

\echo ''
\echo '=== 3. Deactivated people who DO appear on the new-year roster ==='
-- Anyone here was deactivated despite being rostered. That is a straight bug,
-- whatever caused it, and these are safe to reactivate.
WITH years AS (
  SELECT (SELECT id FROM school_years WHERE status = 'active') AS incoming
)
SELECT p.employee_id, p.first_name, p.last_name, p.email, p.role, s.display_name AS school
  FROM people p
  CROSS JOIN years y
  JOIN assignments a
    ON a.user_id = p.employee_id AND a.school_year_id = y.incoming
  LEFT JOIN schools s ON s.id = p.school_id
 WHERE NOT p.is_active
   AND p.role <> 'NO_ACCESS'
 ORDER BY p.last_name, p.first_name;

\echo ''
\echo '=== 4. Reactivated people who still cannot sign in (the Henry Appiah case) ==='
-- Active, has assignment history, but no OPEN assignment in the current year.
-- checkActiveThisYear() returns false for these, so every API call 403s and
-- the dashboard white-screens. Being listed as active in the Users tab tells
-- you nothing about whether they can actually get in.
WITH years AS (
  SELECT (SELECT id FROM school_years WHERE status = 'active') AS incoming
)
SELECT p.employee_id, p.first_name, p.last_name, p.email, p.role, s.display_name AS school
  FROM people p
  CROSS JOIN years y
  LEFT JOIN schools s ON s.id = p.school_id
 WHERE p.is_active
   AND p.role NOT IN ('NO_ACCESS', 'NETWORK_ADMIN')
   AND EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = p.employee_id)
   AND NOT EXISTS (
         SELECT 1 FROM assignments a
          WHERE a.user_id = p.employee_id
            AND a.school_year_id = y.incoming
            AND a.end_date IS NULL)
 ORDER BY p.last_name, p.first_name;
