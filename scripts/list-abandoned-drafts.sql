-- Read-only. Backlog #42, step one continued.
--
-- The first pass matched a draft to a finished observation on observer,
-- teacher and rubric set. That is too loose: a coach who observes the same
-- teacher twice in a term matches themselves, so a perfectly good draft from
-- this week looks like a leftover from one published a fortnight ago. 22 of
-- the 25 it flagged hold real writing, which is exactly what that looseness
-- would predict.
--
-- The bug had a precise signature. It published an observation and left the
-- draft that had been feeding it — so the two carry the SAME DATE, and were
-- created minutes apart. That is what is matched here.
--
-- 53 drafts is few enough to read, so this lists all of them rather than
-- reducing them to a number. Nothing is deleted, by this or by anything else,
-- until a human has read the list.

\echo ''
\echo '=== WHICH DATABASE AM I ON? ==============================='
SELECT current_database() AS database;
\echo 'Must say neondb.'

\echo ''
\echo '=== Every draft, with the bug signature marked ============'
SELECT
  d.id,
  COALESCE(ob.first_name || ' ' || ob.last_name, '(unknown)')  AS observer,
  COALESCE(te.first_name || ' ' || te.last_name, '(none)')     AS teacher,
  s.abbreviation                                               AS school,
  d.date,
  CASE
    WHEN COALESCE(regexp_replace(d.strengths,    '<[^>]*>', '', 'g'), '') = ''
     AND COALESCE(regexp_replace(d.growth_areas, '<[^>]*>', '', 'g'), '') = ''
     AND NOT EXISTS (SELECT 1 FROM observation_scores sc WHERE sc.observation_id = d.id)
    THEN 'empty'
    ELSE 'has writing'
  END                                                          AS content,
  twin.id                                                      AS published_twin,
  CASE
    WHEN twin.id IS NULL                       THEN 'no twin - real work in progress'
    WHEN abs(EXTRACT(EPOCH FROM (twin.created_at - d.created_at))) < 3600
                                               THEN 'LEFTOVER - twin filed within the hour'
    ELSE 'same day, but hours apart - look'
  END                                                          AS verdict
FROM observations d
LEFT JOIN people  ob ON ob.employee_id = d.observer_employee_id
LEFT JOIN people  te ON te.employee_id = d.observed_employee_id
LEFT JOIN schools s  ON s.id           = d.school_id
LEFT JOIN LATERAL (
  SELECT f.id, f.created_at
    FROM observations f
   WHERE f.status <> 'draft'
     AND f.observer_employee_id IS NOT DISTINCT FROM d.observer_employee_id
     AND f.observed_employee_id IS NOT DISTINCT FROM d.observed_employee_id
     AND f.rubric_set_id        =  d.rubric_set_id
     AND f.date                 =  d.date          -- same date: the signature
   ORDER BY abs(EXTRACT(EPOCH FROM (f.created_at - d.created_at)))
   LIMIT 1
) twin ON TRUE
WHERE d.status = 'draft'
ORDER BY verdict, observer, d.date;

\echo ''
\echo '=== Summary =============================================='
SELECT
  count(*)                                                          AS all_drafts,
  count(*) FILTER (WHERE twin.id IS NOT NULL
                     AND abs(EXTRACT(EPOCH FROM (twin.created_at - d.created_at))) < 3600)
                                                                    AS clear_leftovers,
  count(*) FILTER (WHERE twin.id IS NOT NULL
                     AND abs(EXTRACT(EPOCH FROM (twin.created_at - d.created_at))) >= 3600)
                                                                    AS same_day_but_unclear,
  count(*) FILTER (WHERE twin.id IS NULL)                           AS real_work_in_progress
FROM observations d
LEFT JOIN LATERAL (
  SELECT f.id, f.created_at
    FROM observations f
   WHERE f.status <> 'draft'
     AND f.observer_employee_id IS NOT DISTINCT FROM d.observer_employee_id
     AND f.observed_employee_id IS NOT DISTINCT FROM d.observed_employee_id
     AND f.rubric_set_id        =  d.rubric_set_id
     AND f.date                 =  d.date
   ORDER BY abs(EXTRACT(EPOCH FROM (f.created_at - d.created_at)))
   LIMIT 1
) twin ON TRUE
WHERE d.status = 'draft';
