-- Read-only. Counts nothing but rows; changes nothing.
--
-- Backlog #42, step one: how many leftover drafts are there?
--
-- A leftover is a draft that has a FINISHED observation beside it — same
-- observer, same teacher, same rubric set. That pairing is what makes it a
-- duplicate of submitted work rather than something half-written that
-- somebody means to come back to. Age is deliberately not the test: people
-- leave a genuine draft overnight all the time, and deleting on age alone
-- would throw away real work.

\echo ''
\echo '=== WHICH DATABASE AM I ON? ==============================='
SELECT current_database() AS database,
       (SELECT name FROM school_years WHERE status = 'active') AS active_year,
       (SELECT count(*) FROM people) AS people;
\echo 'Production is neondb. If this says heliumdb, STOP — that is dev.'

\echo ''
\echo '=== 1. Drafts overall ====================================='
SELECT count(*) FILTER (WHERE o.status = 'draft')     AS drafts,
       count(*) FILTER (WHERE o.status <> 'draft')    AS finished
  FROM observations o;

\echo ''
\echo '=== 2. How many of those drafts are leftovers? ============'
WITH leftovers AS (
  SELECT d.id
    FROM observations d
   WHERE d.status = 'draft'
     AND EXISTS (
           SELECT 1
             FROM observations f
            WHERE f.status <> 'draft'
              AND f.observer_employee_id  IS NOT DISTINCT FROM d.observer_employee_id
              AND f.observed_employee_id  IS NOT DISTINCT FROM d.observed_employee_id
              AND f.rubric_set_id         =  d.rubric_set_id
         )
)
SELECT (SELECT count(*) FROM observations WHERE status = 'draft') AS all_drafts,
       (SELECT count(*) FROM leftovers)                           AS looks_like_a_leftover,
       (SELECT count(*) FROM observations WHERE status = 'draft')
         - (SELECT count(*) FROM leftovers)                       AS genuinely_in_progress;

\echo ''
\echo '=== 3. Who is carrying them ==============================='
WITH leftovers AS (
  SELECT d.*
    FROM observations d
   WHERE d.status = 'draft'
     AND EXISTS (
           SELECT 1 FROM observations f
            WHERE f.status <> 'draft'
              AND f.observer_employee_id IS NOT DISTINCT FROM d.observer_employee_id
              AND f.observed_employee_id IS NOT DISTINCT FROM d.observed_employee_id
              AND f.rubric_set_id        =  d.rubric_set_id
         )
)
SELECT COALESCE(p.first_name || ' ' || p.last_name, '(unknown observer)') AS observer,
       s.display_name                                                     AS school,
       count(*)                                                           AS leftover_drafts,
       min(l.date)                                                        AS oldest,
       max(l.date)                                                        AS newest
  FROM leftovers l
  LEFT JOIN people  p ON p.employee_id = l.observer_employee_id
  LEFT JOIN schools s ON s.id          = l.school_id
 GROUP BY 1, 2
 ORDER BY leftover_drafts DESC, observer;

\echo ''
\echo '=== 4. Are they empty, or do they hold written work? ======'
-- Empty ones are trivially safe to remove. Ones with writing in them deserve
-- a look before anything is deleted, even where a finished twin exists.
WITH leftovers AS (
  SELECT d.*
    FROM observations d
   WHERE d.status = 'draft'
     AND EXISTS (
           SELECT 1 FROM observations f
            WHERE f.status <> 'draft'
              AND f.observer_employee_id IS NOT DISTINCT FROM d.observer_employee_id
              AND f.observed_employee_id IS NOT DISTINCT FROM d.observed_employee_id
              AND f.rubric_set_id        =  d.rubric_set_id
         )
)
SELECT count(*) FILTER (
         WHERE COALESCE(regexp_replace(l.strengths,   '<[^>]*>', '', 'g'), '') = ''
           AND COALESCE(regexp_replace(l.growth_areas,'<[^>]*>', '', 'g'), '') = ''
           AND NOT EXISTS (SELECT 1 FROM observation_scores sc WHERE sc.observation_id = l.id)
       ) AS completely_empty,
       count(*) FILTER (
         WHERE COALESCE(regexp_replace(l.strengths,   '<[^>]*>', '', 'g'), '') <> ''
            OR COALESCE(regexp_replace(l.growth_areas,'<[^>]*>', '', 'g'), '') <> ''
            OR EXISTS (SELECT 1 FROM observation_scores sc WHERE sc.observation_id = l.id)
       ) AS has_something_written
  FROM leftovers l;
