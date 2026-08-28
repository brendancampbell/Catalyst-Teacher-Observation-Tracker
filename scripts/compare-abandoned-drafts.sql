-- Read-only. Backlog #42, the check before anything is deleted.
--
-- 17 drafts carry the bug's signature, and 14 of them hold written words.
-- "It is a duplicate" is a claim about those words: the published twin has to
-- actually contain the writing, or deleting the draft destroys the only copy.
--
-- So this puts them side by side. Nothing is deleted by this script, and
-- nothing should be deleted until these read as the same work.

\echo ''
\echo '=== WHICH DATABASE AM I ON? ==============================='
SELECT current_database() AS database;

\echo ''
\echo '=== Draft vs its published twin ==========================='
WITH pairs AS (
  SELECT d.id AS draft_id, twin.id AS twin_id
    FROM observations d
    JOIN LATERAL (
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
   WHERE d.status = 'draft'
)
SELECT
  p.draft_id,
  p.twin_id,
  CASE WHEN p.twin_id < p.draft_id THEN 'ODD - published BEFORE the draft' ELSE '' END AS note,
  length(COALESCE(regexp_replace(d.strengths,    '<[^>]*>', '', 'g'), '')) AS draft_glow_len,
  length(COALESCE(regexp_replace(t.strengths,    '<[^>]*>', '', 'g'), '')) AS twin_glow_len,
  length(COALESCE(regexp_replace(d.growth_areas, '<[^>]*>', '', 'g'), '')) AS draft_grow_len,
  length(COALESCE(regexp_replace(t.growth_areas, '<[^>]*>', '', 'g'), '')) AS twin_grow_len,
  (SELECT count(*) FROM observation_scores sc WHERE sc.observation_id = d.id) AS draft_scores,
  (SELECT count(*) FROM observation_scores sc WHERE sc.observation_id = t.id) AS twin_scores,
  CASE
    WHEN COALESCE(regexp_replace(d.strengths,    '<[^>]*>', '', 'g'), '') = ''
     AND COALESCE(regexp_replace(d.growth_areas, '<[^>]*>', '', 'g'), '') = ''
     AND NOT EXISTS (SELECT 1 FROM observation_scores sc WHERE sc.observation_id = d.id)
      THEN 'SAFE - draft is empty'
    WHEN position(
           btrim(COALESCE(regexp_replace(d.strengths, '<[^>]*>', '', 'g'), ''))
           in COALESCE(regexp_replace(t.strengths, '<[^>]*>', '', 'g'), '')
         ) > 0
     AND position(
           btrim(COALESCE(regexp_replace(d.growth_areas, '<[^>]*>', '', 'g'), ''))
           in COALESCE(regexp_replace(t.growth_areas, '<[^>]*>', '', 'g'), '')
         ) > 0
      THEN 'SAFE - twin contains every word of the draft'
    ELSE 'READ IT - draft has words the twin does not'
  END AS verdict
FROM pairs p
JOIN observations d ON d.id = p.draft_id
JOIN observations t ON t.id = p.twin_id
ORDER BY verdict, p.draft_id;

\echo ''
\echo '=== The words themselves, where they differ =============='
-- Only the ones the check could not clear. Read these before deciding.
WITH pairs AS (
  SELECT d.id AS draft_id, twin.id AS twin_id
    FROM observations d
    JOIN LATERAL (
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
   WHERE d.status = 'draft'
)
SELECT p.draft_id, p.twin_id,
       left(regexp_replace(COALESCE(d.strengths,'')    , '<[^>]*>', '', 'g'), 160) AS draft_glow,
       left(regexp_replace(COALESCE(t.strengths,'')    , '<[^>]*>', '', 'g'), 160) AS twin_glow,
       left(regexp_replace(COALESCE(d.growth_areas,''),  '<[^>]*>', '', 'g'), 160) AS draft_grow,
       left(regexp_replace(COALESCE(t.growth_areas,''),  '<[^>]*>', '', 'g'), 160) AS twin_grow
  FROM pairs p
  JOIN observations d ON d.id = p.draft_id
  JOIN observations t ON t.id = p.twin_id
 WHERE NOT (
   position(btrim(COALESCE(regexp_replace(d.strengths,    '<[^>]*>', '', 'g'), ''))
            in COALESCE(regexp_replace(t.strengths,       '<[^>]*>', '', 'g'), '')) > 0
   AND position(btrim(COALESCE(regexp_replace(d.growth_areas, '<[^>]*>', '', 'g'), ''))
            in COALESCE(regexp_replace(t.growth_areas,        '<[^>]*>', '', 'g'), '')) > 0
 )
 ORDER BY p.draft_id;
