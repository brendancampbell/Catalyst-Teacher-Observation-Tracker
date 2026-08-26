-- Read-only. Run against PRODUCTION.
--
-- Essence Edwards has an orphaned action step, but her observation was not
-- deleted. Only two things null assigned_during_observation_id: the ON DELETE
-- SET NULL when an observation goes, or an explicit update, and nothing in the
-- code does the latter.
--
-- So the step probably came from a DIFFERENT observation than the one she
-- still has — most likely a draft that was discarded. Until this week a draft
-- created a real action step on its first autosave, so discarding it orphaned
-- the step while leaving any later, properly published observation intact.
--
-- Comparing timestamps should show it: if the step was created at a moment
-- when no surviving observation was created, it belonged to something that is
-- now gone.

\echo '=== 1. Who she is ==='
SELECT p.employee_id, p.first_name, p.last_name, p.email, p.role, p.is_active,
       s.display_name AS school
  FROM people p
  LEFT JOIN schools s ON s.id = p.school_id
 WHERE lower(p.first_name) = 'essence' AND lower(p.last_name) = 'edwards';

\echo ''
\echo '=== 2. Every observation she has ==='
SELECT o.id, o.date, o.status, o.target,
       ob.first_name || ' ' || ob.last_name AS observer,
       o.created_at AS observation_created,
       o.pending_action_step_text
  FROM observations o
  JOIN people p   ON p.employee_id = o.observed_employee_id
  LEFT JOIN people ob ON ob.employee_id = o.observer_employee_id
 WHERE lower(p.first_name) = 'essence' AND lower(p.last_name) = 'edwards'
 ORDER BY o.created_at;

\echo ''
\echo '=== 3. Every action step she has ==='
-- assigned_during is the telling column. Null means its observation is gone.
SELECT a.id, a.text, a.status, a.due_date,
       a.assigned_during_observation_id AS assigned_during,
       a.created_at AS step_created,
       ab.first_name || ' ' || ab.last_name AS assigned_by
  FROM action_steps a
  JOIN people p    ON p.employee_id = a.teacher_employee_id
  LEFT JOIN people ab ON ab.employee_id = a.assigned_by_employee_id
 WHERE lower(p.first_name) = 'essence' AND lower(p.last_name) = 'edwards'
 ORDER BY a.created_at;

\echo ''
\echo '=== 4. All six orphans, with the nearest observation in time ==='
-- If each orphan sits a few seconds from an observation that still exists,
-- they came from the same session and something else is going on. If they sit
-- alone, the observation that made them is gone.
SELECT a.id AS step_id,
       p.first_name || ' ' || p.last_name AS teacher,
       a.created_at AS step_created,
       (SELECT o.id FROM observations o
         WHERE o.observed_employee_id = a.teacher_employee_id
         ORDER BY abs(extract(epoch FROM (o.created_at - a.created_at)))
         LIMIT 1) AS nearest_observation,
       (SELECT round(abs(extract(epoch FROM (o.created_at - a.created_at))))
          FROM observations o
         WHERE o.observed_employee_id = a.teacher_employee_id
         ORDER BY abs(extract(epoch FROM (o.created_at - a.created_at)))
         LIMIT 1) AS seconds_apart,
       (SELECT o.status FROM observations o
         WHERE o.observed_employee_id = a.teacher_employee_id
         ORDER BY abs(extract(epoch FROM (o.created_at - a.created_at)))
         LIMIT 1) AS nearest_status
  FROM action_steps a
  LEFT JOIN people p ON p.employee_id = a.teacher_employee_id
 WHERE a.assigned_during_observation_id IS NULL
 ORDER BY a.created_at;
