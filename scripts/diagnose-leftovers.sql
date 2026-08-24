-- Read-only. Run against PRODUCTION.
--
-- Two questions left over from the roster repair:
--   A. the people switched off with no row on the current year's roster
--   B. employee IDs that look like placeholders rather than real HR numbers

\echo '=== A. Switched off, and not on this year roster ==='
-- The repair deliberately did not touch these: absence from the roster is how
-- a genuine departure looks, so switching them on would resurrect people who
-- really did leave. The columns are the evidence for telling those apart.
--
--   signed_in_before  - google_id is set on first Google sign-in, so this says
--                       whether the account was ever actually used
--   last_used         - most recent day they used Catalyst at all
--   observations_made - work they did as an observer
--   steps_assigned    - action steps they handed out
--
-- Someone with no sign-in and no work is very likely a departure or an account
-- that never went anywhere. Someone who was using it in June and is now off is
-- worth asking about.
WITH y AS (SELECT (SELECT id FROM school_years WHERE status='active') AS incoming)
SELECT p.employee_id, p.first_name, p.last_name, p.email, p.role,
       s.display_name AS school,
       (p.google_id IS NOT NULL) AS signed_in_before,
       (SELECT max(u.activity_date) FROM user_activity_days u
         WHERE u.employee_id = p.employee_id) AS last_used,
       (SELECT count(*) FROM observations o
         WHERE o.observer_employee_id = p.employee_id) AS observations_made,
       (SELECT count(*) FROM action_steps a
         WHERE a.assigned_by_employee_id = p.employee_id) AS steps_assigned,
       (SELECT sy.name FROM assignments a JOIN school_years sy ON sy.id = a.school_year_id
         WHERE a.user_id = p.employee_id
         ORDER BY a.start_date DESC, a.id DESC LIMIT 1) AS last_year_rostered,
       p.created_at::date AS created
  FROM people p
  CROSS JOIN y
  LEFT JOIN schools s ON s.id = p.school_id
 WHERE NOT p.is_active
   AND p.role <> 'NO_ACCESS'
   AND NOT EXISTS (SELECT 1 FROM assignments a
                    WHERE a.user_id = p.employee_id AND a.school_year_id = y.incoming)
 ORDER BY signed_in_before DESC, last_used DESC NULLS LAST, p.last_name;

\echo ''
\echo '=== B. Employee IDs that look like placeholders ==='
-- Heuristics, not proof. Real ids in this system look like EE00004812,
-- CW00000511, 013191, 10422, or a random 9-character code such as VQJF1N7A8.
-- Anything below is worth a human glance.
SELECT p.employee_id, p.first_name, p.last_name, p.email, p.role, p.is_active,
       s.display_name AS school,
       (p.google_id IS NOT NULL) AS signed_in_before,
       CASE
         WHEN p.employee_id ~ '^(.)\1+$'                       THEN 'one character repeated'
         WHEN p.employee_id ~* '(test|demo|temp|dummy|sample|fake|placeholder|xxx|tbd|asdf)'
                                                               THEN 'contains a placeholder word'
         WHEN p.employee_id IN ('123456789','12345678','1234567','123456','12345',
                                '1234','123','987654321','0123456789','1234567890')
                                                               THEN 'sequential digits'
         WHEN p.employee_id ~ '^0+$'                           THEN 'all zeros'
         WHEN length(p.employee_id) < 4                        THEN 'suspiciously short'
       END AS why
  FROM people p
  LEFT JOIN schools s ON s.id = p.school_id
 WHERE p.employee_id ~ '^(.)\1+$'
    OR p.employee_id ~* '(test|demo|temp|dummy|sample|fake|placeholder|xxx|tbd|asdf)'
    OR p.employee_id IN ('123456789','12345678','1234567','123456','12345',
                         '1234','123','987654321','0123456789','1234567890')
    OR p.employee_id ~ '^0+$'
    OR length(p.employee_id) < 4
 ORDER BY why, p.last_name;

\echo ''
\echo '=== C. Shape of every employee id in use, for comparison ==='
-- Establishes what normal looks like here, so anything above can be judged
-- against it rather than against a guess. Digits become 9 and letters A.
SELECT regexp_replace(regexp_replace(employee_id, '[0-9]', '9', 'g'), '[A-Za-z]', 'A', 'g') AS shape,
       count(*) AS people,
       min(employee_id) AS example
  FROM people
 GROUP BY shape
 ORDER BY people DESC;
