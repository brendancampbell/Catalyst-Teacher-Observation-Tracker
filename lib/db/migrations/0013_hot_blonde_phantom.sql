ALTER TABLE "observations" ADD COLUMN "pending_action_step_text" text;--> statement-breakpoint
ALTER TABLE "observations" ADD COLUMN "pending_action_step_due_date" date;--> statement-breakpoint

-- MIGRATE-DATA: pull draft-created action steps back onto their drafts
-- ⚠️  DATA BACKFILL — moves action steps off unpublished drafts
--
-- A draft used to create a real action step the moment it autosaved, which put
-- a live step on a teacher's list before anybody had decided to give it to
-- them. Steps are now held on the draft until it is published, so the ones
-- already created this way are moved back.
--
-- Deliberately narrow. Only steps that are:
--
--   * attached to an observation that is still a DRAFT — a published
--     observation's step is a real assignment and is left entirely alone
--   * still open — never mastered
--   * never extended — an extension means a coach and a teacher have already
--     talked about the due date
--   * the only such step on that draft — if a draft somehow has two, both are
--     left alone rather than picking one to keep
--
-- Anything failing those tests keeps its row. Retracting a step a teacher has
-- already worked on would be worse than leaving an odd one attached to a
-- draft, and the deletion rules being added alongside this handle those.
UPDATE observations o
   SET pending_action_step_text     = s.text,
       pending_action_step_due_date = s.due_date
  FROM action_steps s
 WHERE s.assigned_during_observation_id = o.id
   AND o.status = 'draft'
   AND s.status = 'open'
   AND NOT EXISTS (
         SELECT 1 FROM action_step_extensions e WHERE e.action_step_id = s.id)
   AND s.mastered_during_observation_id IS NULL
   AND (SELECT count(*) FROM action_steps s2
         WHERE s2.assigned_during_observation_id = o.id) = 1;--> statement-breakpoint

DELETE FROM action_steps s
 USING observations o
 WHERE s.assigned_during_observation_id = o.id
   AND o.status = 'draft'
   AND s.status = 'open'
   AND o.pending_action_step_text IS NOT NULL
   AND s.text = o.pending_action_step_text
   AND NOT EXISTS (
         SELECT 1 FROM action_step_extensions e WHERE e.action_step_id = s.id)
   AND s.mastered_during_observation_id IS NULL;
