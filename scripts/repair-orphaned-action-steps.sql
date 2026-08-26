-- THIS WRITES. Run against PRODUCTION, after reading
-- scripts/list-orphaned-action-steps.sql.
--
-- Cleans up action steps whose observation was deleted before the rules
-- shipped. Applies exactly what the new delete does, so the database ends up
-- in the state it would have been in had the rules existed at the time:
--
--   * a step another observation has TOUCHED survives and moves there, most
--     recent extension first, then the observation that mastered it
--   * a step nothing else has touched is deleted
--
-- With one deliberate exception. A MASTERED step that nothing else touched is
-- NOT deleted here — it is listed instead. Deleting one removes work a teacher
-- was credited for, and that was agreed as something to be warned about rather
-- than done in bulk. Decide those individually.
--
-- Ends with COMMIT. Change it to ROLLBACK to rehearse without saving.

BEGIN;

\echo '=== Before ==='
SELECT count(*) AS orphaned_steps
  FROM action_steps WHERE assigned_during_observation_id IS NULL;

\echo ''
\echo '=== Moving steps another observation touched ==='
-- Most recent extension wins; otherwise the observation that mastered it.
WITH home AS (
  SELECT a.id AS step_id,
         COALESCE(
           (SELECT e.extended_during_observation_id
              FROM action_step_extensions e
             WHERE e.action_step_id = a.id
               AND e.extended_during_observation_id IS NOT NULL
             ORDER BY e.created_at DESC, e.id DESC
             LIMIT 1),
           a.mastered_during_observation_id
         ) AS new_home
    FROM action_steps a
   WHERE a.assigned_during_observation_id IS NULL
)
UPDATE action_steps a
   SET assigned_during_observation_id = home.new_home,
       updated_at = now()
  FROM home
 WHERE a.id = home.step_id
   AND home.new_home IS NOT NULL
RETURNING a.id AS step_id, a.text, a.assigned_during_observation_id AS moved_to;

\echo ''
\echo '=== Deleting steps nothing else touched, and that are not mastered ==='
DELETE FROM action_steps a
 WHERE a.assigned_during_observation_id IS NULL
   AND a.status <> 'mastered'
   AND NOT EXISTS (
         SELECT 1 FROM action_step_extensions e
          WHERE e.action_step_id = a.id
            AND e.extended_during_observation_id IS NOT NULL)
   AND a.mastered_during_observation_id IS NULL
RETURNING a.id AS step_id, a.teacher_employee_id, a.text;

\echo ''
\echo '=== LEFT FOR YOU: mastered steps with no observation left ==='
-- Deleting these removes completed work from a teacher's record, so they are
-- not touched in bulk. If the observation really was deleted in error the step
-- should probably go too; if the teacher genuinely did the work, leaving it is
-- the kinder wrong answer.
SELECT a.id AS step_id,
       p.first_name || ' ' || p.last_name AS teacher,
       s.display_name AS school,
       a.text, a.due_date, a.mastered_at::date AS mastered_on
  FROM action_steps a
  LEFT JOIN people  p ON p.employee_id = a.teacher_employee_id
  LEFT JOIN schools s ON s.id = a.snapshot_school_id
 WHERE a.assigned_during_observation_id IS NULL
 ORDER BY s.display_name, p.last_name;

\echo ''
\echo '=== After: remaining orphans should be mastered ones only ==='
SELECT count(*) FILTER (WHERE status = 'mastered')  AS mastered_left,
       count(*) FILTER (WHERE status <> 'mastered') AS should_be_zero
  FROM action_steps WHERE assigned_during_observation_id IS NULL;

COMMIT;
