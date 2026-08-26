-- THIS WRITES. Run against PRODUCTION.
--
-- Deletes the six action steps whose observation no longer exists. Each was
-- reviewed by hand on 25 Aug and approved individually:
--
--   11  Allison Jones      Camden Prep HS                  mastered
--   50  Trinity Conant     Camden Prep HS                  mastered
--   68  Madalyn Cummings   NSA Lincoln Park HS             open
--   69  Noah Bullwinkle    NSA Lincoln Park HS             open
--   89  Essence Edwards    Uncommon Leadership Charter HS  open
--   93  Vanessa Cruz       NSA Lincoln Park HS             open
--
-- Most are duplicates rather than lost feedback. Until this week a draft
-- created a real action step on its first autosave, so a coach who drafted,
-- discarded, and then wrote the observation properly ended up with two: one
-- orphaned, one attached. Essence Edwards shows it exactly — step 89 from the
-- draft and step 95 on the published observation, differing by one word.
--
-- Ids are named rather than matched by a rule, because the judgement was made
-- person by person and the script should be auditable against that.
--
-- Ends with COMMIT. Change it to ROLLBACK to rehearse without saving.

BEGIN;

CREATE TEMP TABLE approved (id integer PRIMARY KEY) ON COMMIT DROP;
INSERT INTO approved (id) VALUES (11), (50), (68), (69), (89), (93);

-- Refuse if the database is not in the state that was reviewed. Better to stop
-- than to delete somebody's action step on a stale list.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM action_steps a JOIN approved x ON x.id = a.id
   WHERE a.assigned_during_observation_id IS NULL;
  IF n <> 6 THEN
    RAISE EXCEPTION
      'expected 6 approved orphans, found %. Re-run list-orphaned-action-steps.sql and review again', n;
  END IF;
END $$;

\echo '=== Deleting ==='
DELETE FROM action_steps a
 USING approved x
 WHERE a.id = x.id
RETURNING a.id, a.teacher_employee_id, a.status, a.text;

\echo ''
\echo '=== What those six teachers still have ==='
-- The reassurance: where a step was a draft duplicate, the real one remains.
SELECT p.first_name || ' ' || p.last_name AS teacher,
       a.id AS step_id, a.status, a.due_date,
       a.assigned_during_observation_id AS on_observation,
       a.text
  FROM action_steps a
  JOIN people p ON p.employee_id = a.teacher_employee_id
 WHERE a.teacher_employee_id IN (
         SELECT teacher_employee_id FROM action_steps
          UNION
         SELECT employee_id FROM people
          WHERE (lower(first_name), lower(last_name)) IN (
            ('allison','jones'), ('trinity','conant'), ('madalyn','cummings'),
            ('noah','bullwinkle'), ('essence','edwards'), ('vanessa','cruz'))
       )
   AND EXISTS (SELECT 1 FROM people p2
                WHERE p2.employee_id = a.teacher_employee_id
                  AND (lower(p2.first_name), lower(p2.last_name)) IN (
                    ('allison','jones'), ('trinity','conant'), ('madalyn','cummings'),
                    ('noah','bullwinkle'), ('essence','edwards'), ('vanessa','cruz')))
 ORDER BY p.last_name, a.id;

\echo ''
\echo '=== After: no orphans should remain ==='
SELECT count(*) AS should_be_zero
  FROM action_steps WHERE assigned_during_observation_id IS NULL;

COMMIT;
