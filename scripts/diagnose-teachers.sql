-- Read-only. Run against PRODUCTION.
--
-- Written to work AFTER the teachers have already been reactivated by hand.
--
-- That matters. The obvious query — "which teachers are switched off?" — now
-- returns nothing useful, because they have been switched back on. And if the
-- reactivation happened after 24 Aug it also wrote them a roster row, so
-- "missing from this year's roster" has been erased as well. Both of the
-- signals the first version of this file relied on are gone.
--
-- What survives a manual repair:
--
--   * a duplicate person record, if the upload created one
--   * WHEN the roster row was written — the rollover wrote everybody's on the
--     same few days; a row dated well after that was written by hand
--
-- Both are asked below without reference to is_active.

\echo '=== 1. When was this year roster written? ==='
-- Establishes the baseline. The big cluster is the upload; anything long after
-- it was somebody fixing a person by hand.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT a.start_date, count(*) AS assignments_written
  FROM assignments a
  CROSS JOIN y
 WHERE a.school_year_id = y.incoming
 GROUP BY a.start_date
 ORDER BY a.start_date;

\echo ''
\echo '=== 2. Teachers whose roster row was written LATE ==='
-- These are the ones repaired by hand: they were absent from the upload, were
-- deactivated at the flip, and somebody put them back. This is the list of who
-- was affected, recoverable even though they now look fine.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming),
bulk AS (
  /* The day the roster landed: the date carrying the most assignments. */
  SELECT a.start_date
    FROM assignments a CROSS JOIN y
   WHERE a.school_year_id = y.incoming
   GROUP BY a.start_date
   ORDER BY count(*) DESC
   LIMIT 1
)
SELECT s.display_name AS school,
       p.employee_id, p.first_name, p.last_name, p.email,
       a.start_date AS rostered_on,
       p.is_active
  FROM people p
  CROSS JOIN y
  CROSS JOIN bulk
  JOIN assignments a
    ON a.user_id = p.employee_id AND a.school_year_id = y.incoming AND a.end_date IS NULL
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS'
   AND a.start_date > bulk.start_date + 7
 ORDER BY s.display_name, p.last_name, p.first_name;

\echo ''
\echo '=== 3. Duplicate teacher records ==='
-- The likeliest cause, and it survives any amount of reactivating. If the
-- spreadsheet carried a different employee id or a changed email, the upload
-- could not match the existing person and CREATED a new one — leaving the
-- original off the roster and deactivated at the flip.
--
-- A row here means the teacher exists twice. Reactivating the old record was
-- the wrong fix: the two need merging, or one retiring, or their observation
-- history ends up split across both.
SELECT p1.employee_id AS id_a, p1.email AS email_a, p1.is_active AS active_a,
       p2.employee_id AS id_b, p2.email AS email_b, p2.is_active AS active_b,
       p1.first_name, p1.last_name,
       s.display_name AS school
  FROM people p1
  JOIN people p2
    ON lower(p2.first_name) = lower(p1.first_name)
   AND lower(p2.last_name)  = lower(p1.last_name)
   AND p2.employee_id > p1.employee_id
  LEFT JOIN schools s ON s.id = p1.school_id
 WHERE p1.role = 'NO_ACCESS' AND p2.role = 'NO_ACCESS'
 ORDER BY p1.last_name, p1.first_name;

\echo ''
\echo '=== 4. Anyone still switched off, or active without a roster row ==='
-- What is left to fix. active_but_unrostered is the quiet one: fine today,
-- and switched off again at the next rollover.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT s.display_name AS school,
       count(*) FILTER (WHERE NOT p.is_active)                         AS still_inactive,
       count(*) FILTER (WHERE p.is_active AND inc.user_id IS NULL)     AS active_but_unrostered
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
HAVING count(*) FILTER (WHERE NOT p.is_active) > 0
    OR count(*) FILTER (WHERE p.is_active AND inc.user_id IS NULL) > 0
 ORDER BY still_inactive DESC, active_but_unrostered DESC;
