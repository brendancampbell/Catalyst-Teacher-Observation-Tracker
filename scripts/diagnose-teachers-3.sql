-- Read-only. Run against PRODUCTION.
--
-- The rollover may not be the culprit at all.
--
-- The flip only deactivates somebody who held an OPEN assignment in the
-- outgoing year and has none in the incoming one. A teacher who was never on
-- last year's roster is invisible to it — the flip cannot have switched them
-- off, because it never considered them.
--
-- What the numbers so far suggest:
--
--   * this year's roster is BIGGER than last year's (2517 vs 2130), so the
--     upload was not missing people
--   * 389 of 402 inactive teachers have never been observed
--   * 11 of the 14 repaired by hand have no grade level and no department
--
-- That is the shape of records that were never properly set up, not of people
-- the rollover dropped. These queries decide it.

\echo '=== 1. Were the inactive teachers ever on last year roster? ==='
-- The decisive split. Somebody with NO outgoing-year assignment could not have
-- been deactivated by the flip, whatever else is true of them.
WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
)
SELECT
  EXISTS (SELECT 1 FROM assignments a
           WHERE a.user_id = p.employee_id AND a.school_year_id = y.outgoing) AS on_last_year_roster,
  EXISTS (SELECT 1 FROM assignments a
           WHERE a.user_id = p.employee_id)                                   AS has_any_assignment_ever,
  count(*) AS inactive_teachers
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office
 GROUP BY 1, 2
 ORDER BY 3 DESC;

\echo ''
\echo '=== 2. When were these records last touched? ==='
-- The flip stamps updated_at on everybody it deactivates. A cluster on 21 Aug
-- is the rollover; anything much older means they were already inactive and
-- the rollover is not the story.
SELECT p.updated_at::date AS last_touched, count(*) AS inactive_teachers
  FROM people p
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS' AND NOT p.is_active AND NOT s.is_home_office
 GROUP BY p.updated_at::date
 ORDER BY inactive_teachers DESC
 LIMIT 15;

\echo ''
\echo '=== 3. The 14 repaired by hand — what were they before? ==='
-- A known-wrong sample. If these were never on last year's roster and were
-- created long ago, they were never properly set up rather than dropped.
WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
)
SELECT p.employee_id, p.first_name, p.last_name,
       p.created_at::date AS created,
       EXISTS (SELECT 1 FROM assignments a
                WHERE a.user_id = p.employee_id AND a.school_year_id = y.outgoing) AS was_on_last_year,
       (SELECT count(*) FROM assignments a WHERE a.user_id = p.employee_id)        AS assignments_ever,
       (SELECT count(*) FROM observations o
         WHERE o.observed_employee_id = p.employee_id)                             AS observations,
       p.include_in_feedback_tracker AS observable
  FROM people p
  CROSS JOIN y
  JOIN assignments a2
    ON a2.user_id = p.employee_id AND a2.school_year_id = y.incoming AND a2.end_date IS NULL
 WHERE p.role = 'NO_ACCESS'
   AND a2.start_date > DATE '2026-08-21'
 ORDER BY p.last_name;

\echo ''
\echo '=== 4. Are inactive teachers even marked observable? ==='
-- includeInFeedbackTracker is what makes somebody appear as a teacher to
-- observe. A record that is inactive AND not observable was never in use.
SELECT p.is_active, p.include_in_feedback_tracker AS observable, count(*) AS teachers
  FROM people p
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS' AND NOT s.is_home_office
 GROUP BY 1, 2
 ORDER BY 3 DESC;

\echo ''
\echo '=== 5. Same question for the ACTIVE teachers, as a control ==='
-- What a working teacher record looks like here, so the inactive ones can be
-- judged against it rather than against an assumption.
WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
)
SELECT
  EXISTS (SELECT 1 FROM assignments a
           WHERE a.user_id = p.employee_id AND a.school_year_id = y.outgoing) AS on_last_year_roster,
  count(*) AS active_teachers,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM observations o
                                  WHERE o.observed_employee_id = p.employee_id)) AS ever_observed
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS' AND p.is_active AND NOT s.is_home_office
 GROUP BY 1
 ORDER BY 2 DESC;
