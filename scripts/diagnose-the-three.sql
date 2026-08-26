-- Read-only. Run against PRODUCTION.
--
-- Three teachers WERE on the 2026-2027 upload and still did not roll over:
--
--   EE00006077  Trudy Allen       Camden Prep HS
--   EE00006228  Anthony Chen      NSA Washington Park HS
--   EE00004396  Tykesha Hollman   NSA Washington Park HS
--
-- The other eleven were absent from the sheet, so Catalyst did what it was
-- told for those. These three are the actual defect.
--
-- One lead already: Hollman appeared in the "46 rostered but deactivated"
-- group as a COACH at the same school, which means her row DID upload and she
-- DID get a roster row — she was switched off by the flip and the later upload
-- could not switch her back on. That is the bug fixed on 24 Aug, not a new
-- one. Query 2 confirms or kills that.

\echo '=== 1. The person record for each ==='
SELECT p.employee_id, p.first_name, p.last_name, p.email,
       p.role, p.is_active, p.include_in_feedback_tracker AS observable,
       s.display_name AS school,
       p.created_at::date AS created,
       p.updated_at       AS last_touched
  FROM people p
  LEFT JOIN schools s ON s.id = p.school_id
 WHERE p.employee_id IN ('EE00006077','EE00006228','EE00004396')
 ORDER BY p.last_name;

\echo ''
\echo '=== 2. Every assignment they have ever had ==='
-- The whole story. A 2026-2027 row dated 21 Aug means the upload DID carry
-- them and the problem was only that nothing switched them back on. No such
-- row means the upload genuinely skipped them, which is a different fault.
SELECT p.last_name, sy.name AS school_year, a.role, a.school_id,
       a.start_date, a.end_date, a.created_at::date AS row_written
  FROM assignments a
  JOIN people p       ON p.employee_id = a.user_id
  JOIN school_years sy ON sy.id = a.school_year_id
 WHERE a.user_id IN ('EE00006077','EE00006228','EE00004396')
 ORDER BY p.last_name, a.start_date, a.id;

\echo ''
\echo '=== 3. Anybody else who could have been mistaken for them ==='
-- The upload matches on employee id first, then email. A near-miss on either
-- would send the row to the wrong person and leave the real one unrostered.
-- Andy Chen is at the same school as Anthony Chen, which is worth ruling out.
SELECT p.employee_id, p.first_name, p.last_name, p.email, p.role, p.is_active,
       s.display_name AS school
  FROM people p
  LEFT JOIN schools s ON s.id = p.school_id
 WHERE lower(p.last_name) IN ('allen','chen','hollman')
    OR split_part(lower(p.email),'@',1) IN (
         'trudy.allen','anthony.chen','tykesha.hollman',
         'tallen','achen','thollman')
 ORDER BY p.last_name, p.first_name;

\echo ''
\echo '=== 4. What their colleagues who DID roll over look like ==='
-- Same columns, teachers at the same two schools carried forward on 21 Aug.
-- Any structural difference between these and the three is the cause.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT s.display_name AS school, p.employee_id, p.first_name, p.last_name,
       p.created_at::date AS created,
       a.start_date       AS rostered_on
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
  JOIN assignments a
    ON a.user_id = p.employee_id AND a.school_year_id = y.incoming AND a.end_date IS NULL
 WHERE p.role = 'NO_ACCESS'
   AND s.display_name IN ('Camden Prep HS','NSA Washington Park HS')
   AND a.start_date = DATE '2026-08-21'
 ORDER BY s.display_name, p.last_name
 LIMIT 16;
