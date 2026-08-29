-- Read-only. Changes nothing. Safe to run against production.
--
-- Backlog #12 leftover: the migration snapshots all say schools.school_number
-- is nullable, but migration 0006 set it NOT NULL. 0006 was hand-written, so
-- drizzle-kit never learned about it and every snapshot since has been wrong.
--
-- Before generating a migration to put that right, this answers the only
-- question that decides whether it is safe: does any environment still hold a
-- school with no number, and did 0006 ever reach it?

\echo ''
\echo '=== 1. Does the constraint exist here? ===================='
SELECT is_nullable AS school_number_is_nullable
  FROM information_schema.columns
 WHERE table_name = 'schools' AND column_name = 'school_number';

\echo ''
\echo '=== 2. Any schools with no number? ======================='
SELECT count(*) FILTER (WHERE school_number IS NULL) AS missing,
       count(*)                                      AS total_schools
  FROM schools;

\echo ''
\echo '=== 3. If any, which ones ================================'
SELECT id, abbreviation, display_name
  FROM schools
 WHERE school_number IS NULL
 ORDER BY id;

\echo ''
\echo '=== 4. Was migration 0006 ever applied here? ============='
SELECT count(*) AS zero_means_this_db_was_built_with_push
  FROM drizzle.__drizzle_migrations;
