-- Read-only. Run against PRODUCTION.
--
-- The teachers left alone by the repair: inactive, and with no open assignment
-- in the current school year. Absence from the roster is how a real departure
-- looks, so these need deciding one at a time.
--
-- taught_last_year separates the two cases. True means they were here in
-- 2025-2026 and the new roster did not mention them — either they left, or
-- they were missed on the sheet. False means the system has never had them on
-- a roster at all.

WITH y AS (
  SELECT (SELECT id FROM school_years WHERE status='active') AS incoming,
         (SELECT id FROM school_years WHERE status <> 'active'
           ORDER BY start_date DESC LIMIT 1)                 AS outgoing
)
SELECT s.display_name AS school,
       p.first_name,
       p.last_name,
       p.email,
       p.employee_id,
       EXISTS (SELECT 1 FROM assignments a
                WHERE a.user_id = p.employee_id
                  AND a.school_year_id = y.outgoing) AS taught_last_year
  FROM people p
  CROSS JOIN y
  JOIN schools s ON s.id = p.school_id
 WHERE p.role = 'NO_ACCESS'
   AND NOT p.is_active
   AND NOT s.is_home_office
   AND NOT EXISTS (SELECT 1 FROM assignments a
                    WHERE a.user_id = p.employee_id
                      AND a.school_year_id = y.incoming
                      AND a.end_date IS NULL)
 ORDER BY s.display_name, p.last_name, p.first_name;
