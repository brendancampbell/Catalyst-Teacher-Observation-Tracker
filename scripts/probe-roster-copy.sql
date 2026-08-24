-- Reproduce, in isolation, the roster copy that two test fixtures depend on.
--
-- Both do the same thing: INSERT INTO assignments ... SELECT ... FROM
-- assignments WHERE school_year_id = <active> AND end_date IS NULL. Against a
-- database seeded from empty, that writes zero rows while the identical SELECT
-- returns ten. This runs the two side by side so the difference is visible
-- rather than inferred.
--
--   bash scripts/test-db.sh bash -c 'psql "$DATABASE_URL" -f scripts/probe-roster-copy.sql'

\set ON_ERROR_STOP off
\echo ''
\echo '===== 1. what the SELECT half sees ====='
SELECT count(*) AS open_in_active_year
  FROM assignments
 WHERE school_year_id = (SELECT id FROM school_years WHERE status = 'active')
   AND end_date IS NULL;

\echo ''
\echo '===== 2. the rows it would copy ====='
SELECT user_id, role, school_id, start_date
  FROM assignments
 WHERE school_year_id = (SELECT id FROM school_years WHERE status = 'active')
   AND end_date IS NULL
 LIMIT 3;

\echo ''
\echo '===== 3. a scratch year to copy into ====='
INSERT INTO school_years (name, status, display_order)
VALUES ('PROBE SCRATCH', 'inactive', 9999)
RETURNING id AS scratch_year_id \gset

\echo ''
\echo '===== 4. the copy, exactly as the fixtures run it ====='
INSERT INTO assignments (user_id, role, school_id, school_year_id, start_date, end_date)
SELECT user_id, role, school_id, :scratch_year_id, start_date, NULL
  FROM assignments
 WHERE school_year_id = (SELECT id FROM school_years WHERE status = 'active')
   AND end_date IS NULL
ON CONFLICT DO NOTHING
RETURNING id;

\echo ''
\echo '===== 5. the same copy WITHOUT on conflict do nothing ====='
\echo '(if this errors, the constraint it names is the answer)'
INSERT INTO assignments (user_id, role, school_id, school_year_id, start_date, end_date)
SELECT user_id, role, school_id, :scratch_year_id, start_date, NULL
  FROM assignments
 WHERE school_year_id = (SELECT id FROM school_years WHERE status = 'active')
   AND end_date IS NULL
RETURNING id;

\echo ''
\echo '===== 6. what landed in the scratch year ====='
SELECT count(*) AS rows_in_scratch FROM assignments WHERE school_year_id = :scratch_year_id;

\echo ''
\echo '===== 7. every unique index on assignments ====='
SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename = 'assignments' AND indexdef ILIKE '%UNIQUE%';
