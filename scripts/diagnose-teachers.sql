-- Read-only. Run against PRODUCTION.
--
-- Teachers were missed by every earlier diagnostic here: they all carried
-- `role <> 'NO_ACCESS'`, and a teacher IS a NO_ACCESS person. Those queries
-- were chasing people locked out of signing in, which teachers never do — but
-- an inactive teacher cannot be observed at all.
--
-- The reported shape matters: at Washington Park HS every teacher who was
-- deactivated should not have been, but the school did NOT lose its whole
-- roster. So the sheet uploaded. These are individual teachers who were on it
-- and did not get a roster row — which is a per-row failure or an identity
-- mismatch, not a missing upload.
--
-- Only NETWORK_ADMIN is exempt from the rollover's deactivation, so a teacher
-- absent from the incoming roster was switched off exactly like anybody else.

\echo '=== 1. The two schools: how much of the roster is affected? ==='
-- If deactivated is small next to teachers, the sheet plainly uploaded and
-- individual rows failed. That is the case worth chasing.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT s.display_name AS school,
       count(*)                                                     AS teachers,
       count(*) FILTER (WHERE p.is_active)                           AS active,
       count(*) FILTER (WHERE NOT p.is_active)                       AS inactive,
       count(*) FILTER (WHERE inc.user_id IS NOT NULL)               AS on_this_year_roster,
       count(*) FILTER (WHERE p.is_active AND inc.user_id IS NULL)   AS active_but_unrostered
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
\echo '=== 2. Is there a DUPLICATE record for anyone switched off? ==='
-- The likeliest cause. If the spreadsheet carried a different employee id or a
-- changed email, the upload could not match the existing person, so it CREATED
-- a new one — and the original, absent from the new roster, was deactivated at
-- the flip. A row here means the teacher exists twice: reactivating the old
-- record is the wrong fix, and the two need merging instead.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming),
off AS (
  SELECT p.* FROM people p
   WHERE p.role = 'NO_ACCESS' AND NOT p.is_active
)
SELECT d.employee_id AS off_id,   d.email  AS off_email,
       liv.employee_id AS live_id, liv.email AS live_email,
       d.first_name, d.last_name,
       liv.is_active AS live_is_active,
       s.display_name AS school
  FROM off d
  JOIN people liv
    ON lower(liv.first_name) = lower(d.first_name)
   AND lower(liv.last_name)  = lower(d.last_name)
   AND liv.employee_id <> d.employee_id
  LEFT JOIN schools s ON s.id = d.school_id
 ORDER BY d.last_name, d.first_name;

\echo ''
\echo '=== 3. Every teacher switched off, with what the roster says about them ==='
-- was_on_last_year + NOT on_this_year = deactivated BY the rollover, because
-- the new roster did not mention them. That is the group to explain.
WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
)
SELECT s.display_name AS school,
       p.employee_id, p.first_name, p.last_name, p.email,
       (EXISTS (SELECT 1 FROM assignments a
                 WHERE a.user_id = p.employee_id AND a.school_year_id = y.outgoing)) AS was_on_last_year,
       (EXISTS (SELECT 1 FROM assignments a
                 WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming))  AS on_this_year,
       p.grade_level,
       p.created_at::date AS created
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS'
   AND NOT p.is_active
   AND NOT s.is_home_office
 ORDER BY s.display_name, p.last_name, p.first_name;

\echo ''
\echo '=== 4. Scale: inactive teachers per school ==='
-- So you can stop finding these one school at a time.
SELECT s.display_name AS school, count(*) AS inactive_teachers
  FROM people p
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS'
   AND NOT p.is_active
   AND NOT s.is_home_office
 GROUP BY s.display_name
 ORDER BY inactive_teachers DESC, s.display_name;
