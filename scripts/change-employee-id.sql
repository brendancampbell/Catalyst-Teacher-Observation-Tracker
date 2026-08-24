-- THIS WRITES. Run against PRODUCTION. Changes one person's employee ID.
--
-- Usage - set both variables, then run:
--
--   psql "$URL" -v old_id=Test123 -v new_id=EE00001234 \
--        -P pager=off -f scripts/change-employee-id.sql
--
-- Ends with COMMIT. Change the last line to ROLLBACK to rehearse first;
-- rehearsing is strongly recommended, since this touches many tables.
--
-- Why this is not a one-line UPDATE
-- ---------------------------------
-- employee_id is the primary key of `people`, and twelve columns across nine
-- tables reference it - observations (three separate columns), action steps,
-- assignments, activity days, chat, quota grants, notifications. None of those
-- foreign keys declares ON UPDATE CASCADE, so Postgres refuses to change the
-- key while any child row exists.
--
-- Deleting the old row and re-adding it is worse, not better: assignments,
-- action steps, chat, activity and quota grants are ON DELETE CASCADE, so the
-- delete would take the person's real history with it, quietly.
--
-- So: create the new row, repoint every child, and only then remove the old
-- one - by which point it owns nothing and the cascades have nothing to take.
--
-- The child columns are discovered from pg_constraint rather than listed here,
-- so a table added later is picked up automatically instead of being silently
-- left behind pointing at an id that no longer exists.
--
-- email and google_id are both UNIQUE, so the new row is created with
-- placeholders and takes the real values after the old row is gone.

\if :{?old_id}
\else
  \echo 'ERROR: pass -v old_id=... and -v new_id=...'
  \quit 1
\endif
\if :{?new_id}
\else
  \echo 'ERROR: pass -v new_id=...'
  \quit 1
\endif

BEGIN;

DO $$
DECLARE
  v_old       text := :'old_id';
  v_new       text := :'new_id';
  v_email     text;
  v_google    text;
  r           record;
  moved       int;
  total       int := 0;
BEGIN
  IF v_old = v_new THEN
    RAISE EXCEPTION 'old and new id are the same';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM people WHERE employee_id = v_old) THEN
    RAISE EXCEPTION 'no person with employee_id %', v_old;
  END IF;
  IF EXISTS (SELECT 1 FROM people WHERE employee_id = v_new) THEN
    RAISE EXCEPTION 'employee_id % is already taken - that would merge two people', v_new;
  END IF;

  SELECT email, google_id INTO v_email, v_google FROM people WHERE employee_id = v_old;

  /* 1. Copy the row wholesale, so columns added later come along without this
        script needing to know about them. */
  CREATE TEMP TABLE _moving ON COMMIT DROP AS
    SELECT * FROM people WHERE employee_id = v_old;

  UPDATE _moving
     SET employee_id = v_new,
         email       = v_email || '.id-change-in-progress',
         google_id   = NULL;

  INSERT INTO people SELECT * FROM _moving;
  RAISE NOTICE 'created % as a copy of %', v_new, v_old;

  /* 2. Repoint every column that references people.employee_id. */
  FOR r IN
    SELECT c.conrelid::regclass::text AS child_table,
           a.attname                  AS child_column
      FROM pg_constraint c
      JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = 'people'::regclass
       AND array_length(c.conkey, 1) = 1
     ORDER BY 1, 2
  LOOP
    EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', r.child_table, r.child_column, r.child_column)
      USING v_new, v_old;
    GET DIAGNOSTICS moved = ROW_COUNT;
    total := total + moved;
    IF moved > 0 THEN
      RAISE NOTICE '  % rows moved in %.%', moved, r.child_table, r.child_column;
    END IF;
  END LOOP;
  RAISE NOTICE '% child rows repointed in total', total;

  /* 3. The old row now owns nothing, so the ON DELETE CASCADEs have nothing
        to take with them. */
  DELETE FROM people WHERE employee_id = v_old;

  /* 4. And the unique values are free again. */
  UPDATE people
     SET email = v_email, google_id = v_google, updated_at = now()
   WHERE employee_id = v_new;

  RAISE NOTICE 'done: % is now %', v_old, v_new;
END $$;

\echo ''
\echo '=== The person, under the new id ==='
SELECT p.employee_id, p.first_name, p.last_name, p.email, p.role, p.is_active,
       (p.google_id IS NOT NULL) AS can_sign_in,
       s.display_name AS school
  FROM people p LEFT JOIN schools s ON s.id = p.school_id
 WHERE p.employee_id = :'new_id';

\echo ''
\echo '=== Their history came with them ==='
SELECT
  (SELECT count(*) FROM assignments        WHERE user_id                 = :'new_id') AS assignments,
  (SELECT count(*) FROM observations       WHERE observer_employee_id    = :'new_id') AS observed_by_them,
  (SELECT count(*) FROM observations       WHERE observed_employee_id    = :'new_id') AS observations_of_them,
  (SELECT count(*) FROM action_steps       WHERE assigned_by_employee_id = :'new_id') AS steps_assigned,
  (SELECT count(*) FROM user_activity_days WHERE employee_id            = :'new_id') AS days_used;

\echo ''
\echo '=== Nothing left behind under the old id ==='
SELECT count(*) AS should_be_zero FROM people WHERE employee_id = :'old_id';

COMMIT;
