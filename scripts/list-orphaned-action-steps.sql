-- Read-only. Run against PRODUCTION.
--
-- Action steps whose observation was deleted.
--
-- The link is ON DELETE SET NULL, so deleting an observation left its action
-- step behind with nothing pointing at where it came from. The step stays
-- open, stays assigned, can go overdue, appears on the teacher's profile and
-- in the Action Center, and counts towards that coach's total in the Usage
-- tab. Vanessa Cruz at Lincoln Park HS is one of these.
--
-- In production a null link means exactly this. Both code paths that create an
-- action step always set it; only the dev seeder omits it, and that cannot run
-- against production.
--
-- `plan` applies the rules agreed on 25 Aug, the same ones the new delete uses:
-- a step another observation has touched survives and moves there, and a step
-- nothing else has touched goes. Mastered steps are called out separately
-- because deleting one removes work a teacher was credited for.

SELECT
  a.id                                        AS step_id,
  p.first_name || ' ' || p.last_name          AS teacher,
  s.display_name                              AS school,
  a.text,
  a.status,
  a.due_date,
  a.created_at::date                          AS assigned_on,
  ab.first_name || ' ' || ab.last_name        AS assigned_by,
  (SELECT count(*) FROM action_step_extensions e
    WHERE e.action_step_id = a.id)            AS extensions,
  a.mastered_during_observation_id            AS mastered_during,
  CASE
    WHEN (SELECT count(*) FROM action_step_extensions e
           WHERE e.action_step_id = a.id
             AND e.extended_during_observation_id IS NOT NULL) > 0
      THEN 'move to the observation that extended it'
    WHEN a.mastered_during_observation_id IS NOT NULL
      THEN 'move to the observation that mastered it'
    WHEN a.status = 'mastered'
      THEN 'DELETE — but it is mastered, so completed work goes with it'
    ELSE 'delete'
  END                                          AS plan
  FROM action_steps a
  LEFT JOIN people  p  ON p.employee_id = a.teacher_employee_id
  LEFT JOIN people  ab ON ab.employee_id = a.assigned_by_employee_id
  LEFT JOIN schools s  ON s.id = a.snapshot_school_id
 WHERE a.assigned_during_observation_id IS NULL
 ORDER BY s.display_name, p.last_name, p.first_name, a.id;
