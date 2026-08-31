-- Read-only. Run against PRODUCTION (neondb).
--
-- One observation by Stephanie Castro on Mei Cruz (Washington Park HS) does not
-- appear anywhere in the app — not on the tracker grid, not in Castro's drafts.
--
-- The likely cause is the 2026-2027 rollover on ~21-23 Aug. Two mechanisms,
-- both of which hide a row that saved perfectly well:
--
--   A. observations.school_year_id still points at 2025-2026. Every list in the
--      app ANDs school_year_id = <active year> — the drafts list included
--      (observations.ts:238) — so a row stamped with the outgoing year is
--      invisible whether it is a draft or published. PUT /observations/:id
--      never re-stamps the year, so a draft written before the flip and
--      published after it KEEPS the old year and disappears on publish.
--
--   B. Mei Cruz is is_active = false or include_in_feedback_tracker = false.
--      The tracker grid builds its rows from people first (dashboard.ts:71),
--      so if she is switched off the row has nowhere to render. The rollover
--      switched off 378 people; 313 were repaired on 25 Aug, some were not.
--
-- Section 4 is the answer: it finds the observation regardless of either, by
-- ignoring the year filter entirely.

\echo '=== 0. Which database is this? Expect neondb. ==='
SELECT current_database(), inet_server_addr()::text AS host;

\echo ''
\echo '=== 1. The school years, and which one is active ==='
-- Note the id of the active year; sections 4 and 5 compare against it.
SELECT id, name, status, start_date, updated_at AS status_last_changed
  FROM school_years
 ORDER BY start_date;

\echo ''
\echo '=== 2. The two people, and whether Cruz can render at all ==='
-- can_render = false means hypothesis B: the observation exists but the grid
-- has no row to put it on.
SELECT p.employee_id, p.first_name, p.last_name, p.role,
       s.display_name AS school,
       p.is_active, p.include_in_feedback_tracker,
       (p.is_active AND p.include_in_feedback_tracker) AS can_render,
       p.updated_at AS person_last_changed
  FROM people p
  LEFT JOIN schools s ON s.id = p.school_id
 WHERE (p.first_name ILIKE 'Mei'       AND p.last_name ILIKE 'Cruz')
    OR (p.first_name ILIKE 'Stephanie' AND p.last_name ILIKE 'Castro')
 ORDER BY p.last_name;

\echo ''
\echo '=== 3. Is Cruz on this year roster? ==='
-- A missing row here is the 25 Aug repair having skipped her.
SELECT p.last_name, sy.name AS school_year, a.start_date, a.end_date,
       a.created_at AS row_written_at
  FROM assignments a
  JOIN people p        ON p.employee_id = a.user_id
  JOIN school_years sy ON sy.id = a.school_year_id
 WHERE p.first_name ILIKE 'Mei' AND p.last_name ILIKE 'Cruz'
 ORDER BY sy.start_date;

\echo ''
\echo '=== 4. THE ANSWER: every observation on Cruz, no year filter ==='
-- stranded = true is hypothesis A: the row is stamped with a year that is no
-- longer active, so nothing in the app will list it.
SELECT o.id, o.date, o.status, o.target,
       sy.name AS stamped_year,
       (sy.status <> 'active') AS stranded,
       rs.slug AS rubric_set, rs_sy.name AS rubric_set_year,
       o.school_id, sch.display_name AS stamped_school,
       obs.first_name || ' ' || obs.last_name AS observer,
       o.created_at, o.updated_at,
       (o.strengths IS NOT NULL OR o.growth_areas IS NOT NULL) AS has_narrative,
       (SELECT count(*) FROM observation_scores os WHERE os.observation_id = o.id) AS score_count
  FROM observations o
  JOIN people p           ON p.employee_id = o.observed_employee_id
  LEFT JOIN school_years sy   ON sy.id = o.school_year_id
  LEFT JOIN rubric_sets  rs   ON rs.id = o.rubric_set_id
  LEFT JOIN school_years rs_sy ON rs_sy.id = rs.school_year_id
  LEFT JOIN schools      sch  ON sch.id = o.school_id
  LEFT JOIN people       obs  ON obs.employee_id = o.observer_employee_id
 WHERE p.first_name ILIKE 'Mei' AND p.last_name ILIKE 'Cruz'
 ORDER BY o.date DESC, o.id DESC;

\echo ''
\echo '=== 5. Is this one row or many? Everything Castro filed, by year ==='
-- If the whole network has stranded rows, this is not about these two people
-- and the repair is a bulk one.
SELECT sy.name AS stamped_year, o.status, count(*) AS observations
  FROM observations o
  JOIN people obs ON obs.employee_id = o.observer_employee_id
  LEFT JOIN school_years sy ON sy.id = o.school_year_id
 WHERE obs.first_name ILIKE 'Stephanie' AND obs.last_name ILIKE 'Castro'
 GROUP BY sy.name, o.status
 ORDER BY sy.name, o.status;

\echo ''
\echo '=== 6. Network-wide: observations stranded on a non-active year ==='
SELECT sy.name AS stamped_year, o.status, count(*) AS observations,
       min(o.date) AS earliest, max(o.date) AS latest
  FROM observations o
  JOIN school_years sy ON sy.id = o.school_year_id
 WHERE sy.status <> 'active'
 GROUP BY sy.name, o.status
 ORDER BY sy.name, o.status;

\echo ''
\echo '=== 7. And the other shape: observable-but-switched-off people ==='
-- Anyone here has observations that cannot render on the tracker grid.
SELECT s.display_name AS school, count(*) AS switched_off_with_observations
  FROM people p
  JOIN schools s ON s.id = p.school_id
 WHERE NOT (p.is_active AND p.include_in_feedback_tracker)
   AND EXISTS (SELECT 1 FROM observations o
                WHERE o.observed_employee_id = p.employee_id)
 GROUP BY s.display_name
 ORDER BY switched_off_with_observations DESC, s.display_name;
