-- Read-only. Run against PRODUCTION.
--
-- Teachers were missed by every earlier diagnostic here: they all carried
-- `role <> 'NO_ACCESS'`, and a teacher IS a NO_ACCESS person. Those queries
-- were chasing people locked out of signing in, which teachers never do — but
-- an inactive teacher cannot be observed at all, so it matters just as much.
--
-- Only NETWORK_ADMIN is exempt from the rollover's deactivation, so a teacher
-- absent from the incoming roster was switched off exactly like anybody else.

\echo '=== 1. The two schools you just fixed: is everybody set? ==='
-- active AND rostered is the pair that matters. A teacher does not sign in, so
-- the roster row is not about access — it is what the NEXT rollover reads.
-- Anybody active but unrostered here is fine today and vulnerable in August.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT s.display_name AS school,
       count(*)                                              AS teachers,
       count(*) FILTER (WHERE p.is_active)                   AS active,
       count(*) FILTER (WHERE NOT p.is_active)               AS still_inactive,
       count(*) FILTER (WHERE p.is_active AND inc.user_id IS NULL) AS active_but_unrostered
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
  LEFT JOIN LATERAL (
    SELECT a.user_id FROM assignments a
     WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming
       AND a.end_date IS NULL LIMIT 1
  ) inc ON true
 WHERE p.role = 'NO_ACCESS'
   AND s.display_name IN ('NSA Washington Park HS', 'Uncommon Leadership Charter HS')
 GROUP BY s.display_name
 ORDER BY s.display_name;

\echo ''
\echo '=== 2. Every school: how many teachers made it onto this year roster? ==='
-- This is the "why". A school where almost no teacher has a 2026-2027 row did
-- not have its sheet uploaded, or had it rejected. A school with a handful
-- missing is individual rows failing. The shape of the number tells you which.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT s.display_name AS school,
       count(*)                                                        AS teachers,
       count(*) FILTER (WHERE inc.user_id IS NOT NULL)                 AS on_this_year_roster,
       count(*) FILTER (WHERE inc.user_id IS NULL)                     AS missing_from_roster,
       count(*) FILTER (WHERE NOT p.is_active)                         AS inactive,
       round(100.0 * count(*) FILTER (WHERE inc.user_id IS NULL) / nullif(count(*),0)) AS pct_missing
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
  LEFT JOIN LATERAL (
    SELECT a.user_id FROM assignments a
     WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming
       AND a.end_date IS NULL LIMIT 1
  ) inc ON true
 WHERE p.role = 'NO_ACCESS'
   AND NOT s.is_home_office
 GROUP BY s.display_name
HAVING count(*) FILTER (WHERE inc.user_id IS NULL) > 0
 ORDER BY pct_missing DESC, missing_from_roster DESC;

\echo ''
\echo '=== 3. Teachers still switched off, everywhere ==='
-- The list you have been finding one school at a time.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT s.display_name AS school, count(*) AS inactive_teachers
  FROM people p
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS'
   AND NOT p.is_active
   AND NOT s.is_home_office
 GROUP BY s.display_name
 ORDER BY inactive_teachers DESC, s.display_name;

\echo ''
\echo '=== 4. Were they ever on LAST year roster? ==='
-- Separates two very different stories. A teacher with a 2025-2026 row and no
-- 2026-2027 row was deactivated BY the rollover — the roster said they left.
-- A teacher with neither was never rostered at all and was switched off by
-- something else, or never properly set up.
WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
)
SELECT
  (EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = p.employee_id AND a.school_year_id = y.outgoing)) AS was_on_last_year,
  (EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming)) AS on_this_year,
  count(*) AS teachers
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS'
   AND NOT p.is_active
   AND NOT s.is_home_office
 GROUP BY 1, 2
 ORDER BY 3 DESC;
