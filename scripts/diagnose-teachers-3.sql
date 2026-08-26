-- Read-only. Run against PRODUCTION.
--
-- Corrections that reset this investigation:
--
--   * blank grade and department is NORMAL — every teacher was uploaded that
--     way, so it says nothing about a record
--   * "never observed" says nothing either: the tool went into real use on
--     24 Aug and holds ~50 observations in total
--   * the 14 repaired teachers taught last year, teach this year, and were
--     ACTIVE before the rollover
--
-- So the flip did deactivate them, and the question is only why they were
-- absent from the incoming roster when this year's roster is larger than last
-- year's overall (2517 vs 2130).

\echo '=== 1. Were the inactive teachers on last year roster? ==='
-- The flip only switches off somebody holding an OPEN assignment in the
-- outgoing year. Anybody without one was deactivated by something else, and
-- belongs to a different question.
WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
)
SELECT
  EXISTS (SELECT 1 FROM assignments a
           WHERE a.user_id = p.employee_id AND a.school_year_id = y.outgoing
             AND a.end_date IS NULL)                                          AS held_open_row_last_year,
  EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = p.employee_id)        AS has_any_assignment_ever,
  count(*) AS inactive_teachers
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office
 GROUP BY 1, 2
 ORDER BY 3 DESC;

\echo ''
\echo '=== 2. When were the inactive records last touched? ==='
-- The flip stamps updated_at on everybody it deactivates, so the rollover
-- should show as one large cluster on its own date.
SELECT p.updated_at::date AS last_touched, count(*) AS inactive_teachers
  FROM people p
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office
 GROUP BY p.updated_at::date
 ORDER BY inactive_teachers DESC
 LIMIT 15;

\echo ''
\echo '=== 3. Per school: how much of the teaching roster is missing? ==='
-- The shape that matters. A school losing a fixed handful looks like rows
-- failing; a school losing a proportion looks like part of a sheet. Sorted by
-- count so the worst-hit schools lead.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT s.display_name AS school,
       count(*)                                            AS teachers,
       count(*) FILTER (WHERE inc.user_id IS NOT NULL)      AS rostered,
       count(*) FILTER (WHERE inc.user_id IS NULL)          AS not_rostered,
       count(*) FILTER (WHERE NOT p.is_active)              AS inactive
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
  LEFT JOIN LATERAL (
    SELECT a.user_id FROM assignments a
     WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming
       AND a.end_date IS NULL LIMIT 1
  ) inc ON true
 WHERE p.role = 'NO_ACCESS' AND NOT s.is_home_office
 GROUP BY s.display_name
 ORDER BY not_rostered DESC, s.display_name
 LIMIT 25;

\echo ''
\echo '=== 4. The 14 repaired: what did their last-year row look like? ==='
-- Their own history is the best clue left. If their outgoing-year assignment
-- differs from everybody else's — a different school, a closed end_date, a
-- different start — that difference is why the upload did not carry them.
WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
)
SELECT p.employee_id, p.first_name, p.last_name,
       p.created_at::date AS person_created,
       old.school_id      AS last_year_school,
       p.school_id        AS person_school,
       old.start_date     AS last_year_start,
       old.end_date       AS last_year_end,
       old.role           AS last_year_role
  FROM people p
  CROSS JOIN y
  JOIN assignments cur
    ON cur.user_id = p.employee_id AND cur.school_year_id = y.incoming AND cur.end_date IS NULL
  LEFT JOIN assignments old
    ON old.user_id = p.employee_id AND old.school_year_id = y.outgoing
 WHERE p.role = 'NO_ACCESS'
   AND cur.start_date > DATE '2026-08-21'
 ORDER BY p.last_name;

\echo ''
\echo '=== 5. Control: what a NOT-missing teacher looks like at the same schools ==='
-- Same columns for teachers at Washington Park HS who WERE carried forward,
-- so the 14 can be compared against their own colleagues rather than a guess.
WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
)
SELECT p.employee_id, p.first_name, p.last_name,
       p.created_at::date AS person_created,
       old.school_id      AS last_year_school,
       old.start_date     AS last_year_start,
       old.end_date       AS last_year_end,
       cur.start_date     AS this_year_start
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
  JOIN assignments cur
    ON cur.user_id = p.employee_id AND cur.school_year_id = y.incoming AND cur.end_date IS NULL
  LEFT JOIN assignments old
    ON old.user_id = p.employee_id AND old.school_year_id = y.outgoing
 WHERE p.role = 'NO_ACCESS'
   AND s.display_name = 'NSA Washington Park HS'
   AND cur.start_date = DATE '2026-08-21'
 ORDER BY p.last_name
 LIMIT 12;
