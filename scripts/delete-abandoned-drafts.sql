-- ⚠️  This one DELETES. Everything before it only read.
--
-- Backlog #42. Thirteen drafts, listed by id rather than found by a rule —
-- each one was read, and each one's published twin was shown to contain its
-- writing. A rule could pick up a fourteenth tomorrow; a list cannot.
--
-- Not on this list, deliberately:
--   370  its twin was published BEFORE it, which is the reverse of the bug,
--        so whatever it is, it is not this
--   405, 441, 452, 455, 465, 531, 591, 619
--        their drafts hold words the published version does not
--
-- Two guards, both of which abort the whole thing rather than half-do it:
--   1. every id must still be a draft — if somebody resumed and published one
--      since the list was drawn up, it is no longer a leftover
--   2. none may have an action step hanging off it. action_steps points at
--      observations with ON DELETE SET NULL, so a raw delete would cut a step
--      loose from where it came from rather than tidying up. The app's own
--      delete handles that properly; this does not, so it refuses instead.

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  ids    int[] := ARRAY[265, 277, 350, 352, 463, 482, 485, 525, 534, 535, 540, 598, 627];
  n_draft int;
  n_steps int;
BEGIN
  SELECT count(*) INTO n_draft
    FROM observations WHERE id = ANY(ids) AND status = 'draft';
  IF n_draft <> array_length(ids, 1) THEN
    RAISE EXCEPTION 'Expected % drafts, found %. Somebody has touched these — re-run the listing.',
      array_length(ids, 1), n_draft;
  END IF;

  SELECT count(*) INTO n_steps
    FROM action_steps
   WHERE assigned_during_observation_id = ANY(ids)
      OR mastered_during_observation_id = ANY(ids);
  IF n_steps > 0 THEN
    RAISE EXCEPTION 'action steps (%) hang off these drafts. Delete those through the app, not here.', n_steps;
  END IF;

  RAISE NOTICE 'Checks passed: % drafts, no action steps attached.', n_draft;
END $$;

\echo ''
\echo '=== About to delete these ================================='
SELECT o.id, o.date,
       COALESCE(ob.first_name || ' ' || ob.last_name, '(unknown)') AS observer,
       COALESCE(te.first_name || ' ' || te.last_name, '(none)')    AS teacher
  FROM observations o
  LEFT JOIN people ob ON ob.employee_id = o.observer_employee_id
  LEFT JOIN people te ON te.employee_id = o.observed_employee_id
 WHERE o.id IN (265, 277, 350, 352, 463, 482, 485, 525, 534, 535, 540, 598, 627)
 ORDER BY o.id;

-- observation_scores cascades, so the scores go with them.
DELETE FROM observations
 WHERE id IN (265, 277, 350, 352, 463, 482, 485, 525, 534, 535, 540, 598, 627)
   AND status = 'draft';

\echo ''
\echo '=== Drafts remaining ======================================'
SELECT count(*) AS drafts_left FROM observations WHERE status = 'draft';

COMMIT;
