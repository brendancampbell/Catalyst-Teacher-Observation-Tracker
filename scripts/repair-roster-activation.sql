-- THIS WRITES. Run against PRODUCTION only after reading the preview queries.
--
-- Repairs the two groups the diagnostics found. Wrapped in a transaction; the
-- last line is COMMIT. Change it to ROLLBACK to rehearse without saving.
--
-- Group 1 - rostered but switched off (46 at time of writing)
--   They hold an OPEN assignment in the active year, so the roster says they
--   work here, and they are marked inactive. The year flip deactivated them,
--   and the later roster upload that put them back on the list had no way to
--   turn them on: a roster upload never writes is_active.
--
-- Group 2 - switched on but not rostered (19 at time of writing)
--   Marked active, with assignment history, and no open assignment in the
--   active year. checkActiveThisYear() returns false for these, so every API
--   call 403s and the dashboard white-screens. This is what reactivating
--   somebody in the Users tab produced before the fix shipped: it wrote the
--   flag and not the roster row.

BEGIN;

\echo '=== Group 1: reactivating people the roster already lists ==='
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
UPDATE people p
   SET is_active = true, updated_at = now()
  FROM y
 WHERE p.is_active = false
   AND p.role <> 'NO_ACCESS'
   AND EXISTS (SELECT 1 FROM assignments a
                WHERE a.user_id = p.employee_id
                  AND a.school_year_id = y.incoming
                  AND a.end_date IS NULL)
RETURNING p.employee_id, p.first_name, p.last_name, p.role;

\echo ''
\echo '=== Group 2: rostering people who are already marked active ==='
-- Mirrors what toggle-active now does on reactivation: open an assignment in
-- the active year using the person's own role and school. Falls back to the
-- school on their most recent assignment when the person row has none, so
-- nobody is skipped for a blank school.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming),
stuck AS (
  SELECT p.employee_id, p.role,
         COALESCE(
           p.school_id,
           (SELECT a.school_id FROM assignments a
             WHERE a.user_id = p.employee_id
             ORDER BY a.start_date DESC, a.id DESC LIMIT 1)
         ) AS school_id
    FROM people p
    CROSS JOIN y
   WHERE p.is_active
     AND p.role NOT IN ('NO_ACCESS','NETWORK_ADMIN')
     AND EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = p.employee_id)
     AND NOT EXISTS (SELECT 1 FROM assignments a
                      WHERE a.user_id = p.employee_id
                        AND a.school_year_id = y.incoming
                        AND a.end_date IS NULL)
)
INSERT INTO assignments (user_id, role, school_id, school_year_id, start_date, end_date)
SELECT s.employee_id, s.role, s.school_id, y.incoming, CURRENT_DATE, NULL
  FROM stuck s CROSS JOIN y
 WHERE s.school_id IS NOT NULL
RETURNING user_id, role, school_id;

\echo ''
\echo '=== Anyone left behind (blank school - needs a human) ==='
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT p.employee_id, p.first_name, p.last_name, p.role
  FROM people p CROSS JOIN y
 WHERE p.is_active
   AND p.role NOT IN ('NO_ACCESS','NETWORK_ADMIN')
   AND EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = p.employee_id)
   AND NOT EXISTS (SELECT 1 FROM assignments a
                    WHERE a.user_id = p.employee_id
                      AND a.school_year_id = y.incoming
                      AND a.end_date IS NULL);

COMMIT;
