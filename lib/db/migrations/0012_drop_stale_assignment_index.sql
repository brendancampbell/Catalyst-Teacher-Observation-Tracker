-- Drop the single-column assignment index that 0001 created.
--
-- 0001 added:
--   CREATE UNIQUE INDEX assignments_user_active_uniq
--     ON assignments (user_id) WHERE end_date IS NULL;
--
-- which allows a person one open assignment ACROSS ALL YEARS. The staged
-- rollover requires the opposite: somebody holds an open assignment in the
-- running year and another in the year being staged, and the flip closes the
-- first. With this index every staged roster row conflicts, so a rollover
-- cannot be prepared at all.
--
-- The schema has always declared the correct index instead —
-- assignments_user_year_active_uniq on (user_id, school_year_id) — and a
-- replacement was written: lib/db/src/migrations/0005_assignments_school_year.sql
-- drops this one and creates that one. But that file sits in a directory the
-- drizzle journal has never listed, so it has only ever run where somebody ran
-- it by hand. The development database has the correct index; a database built
-- from the migrations gets the wrong one.
--
-- Found on 2026-08-21, when the integration suite first ran against a database
-- seeded from empty. Two fixtures copy a roster into a scratch year; both wrote
-- zero rows while the identical SELECT returned ten, because ON CONFLICT DO
-- NOTHING was swallowing every row.
--
-- check:schema-sync could not have caught it. Index comparison is deliberately
-- one-directional: it reports indexes the schema declares and the database
-- lacks, never the reverse, because Postgres creates its own for primary keys
-- and unique constraints and flagging those would make the deploy gate noisy.
-- An index nobody declared is exactly the blind spot that leaves.
--
-- IF EXISTS, so this is a no-op where the index was already removed by hand —
-- which is every environment currently running.
DROP INDEX IF EXISTS assignments_user_active_uniq;

-- Belt and braces: create the correct index if it is somehow absent. The
-- schema declares it, so check:schema-sync would fail the deploy without it.
CREATE UNIQUE INDEX IF NOT EXISTS assignments_user_year_active_uniq
  ON assignments (user_id, school_year_id)
  WHERE end_date IS NULL;
