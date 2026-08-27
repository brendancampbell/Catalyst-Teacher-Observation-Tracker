import { db } from "@workspace/db";
import { systemSettings, people } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { DEFAULT_WINDOW_DAYS } from "@workspace/api-types";

/**
 * The two network-wide deadlines, and what changing them does.
 *
 * Read on nearly every request that computes a rescore date or an overdue
 * list, so it is cached in memory. The row changes about as often as a school
 * year does.
 */

let cached: { rescoreWindowDays: number; overdueWindowDays: number } | null = null;

/** Called after any write, and by the tests. */
export function invalidateSystemSettingsCache(): void {
  cached = null;
}

/**
 * Both windows, in days.
 *
 * Falls back to the hardcoded default if the row is somehow missing — a
 * missing settings row must not stop an observation being saved. It cannot
 * normally be missing: the migration seeds it and a unique partial index keeps
 * it singular.
 */
export async function getWindows(): Promise<{ rescoreWindowDays: number; overdueWindowDays: number }> {
  if (cached) return cached;

  const [row] = await db
    .select({
      rescoreWindowDays: systemSettings.rescoreWindowDays,
      overdueWindowDays: systemSettings.overdueWindowDays,
    })
    .from(systemSettings)
    .where(eq(systemSettings.id, 1))
    .limit(1);

  cached = row ?? {
    rescoreWindowDays: DEFAULT_WINDOW_DAYS,
    overdueWindowDays: DEFAULT_WINDOW_DAYS,
  };
  return cached;
}

/** The rescore due date for a walkthrough on `fromDate`, as an ISO date. */
export async function rescoreDueDateFor(fromDate: string): Promise<string> {
  const { rescoreWindowDays } = await getWindows();
  const due = new Date(fromDate);
  due.setDate(due.getDate() + rescoreWindowDays);
  return due.toISOString().slice(0, 10);
}

/**
 * What changing the rescore window would do to the people already queued.
 *
 * Measured, not estimated: it recomputes each person's date from the
 * walkthrough that flagged them, which is the same arithmetic the change
 * itself performs.
 *
 * rescore_from_date is null only for rows flagged before that column existed
 * and somehow missed by the backfill; those are measured from their existing
 * due date minus the current window, which reproduces the walkthrough date.
 */
export async function previewRescoreChange(newWindowDays: number): Promise<{
  affected: number;
  newlyOverdue: number;
}> {
  const { rescoreWindowDays } = await getWindows();

  const [row] = await db
    .select({
      affected: sql<number>`count(*)::int`,
      newlyOverdue: sql<number>`count(*) FILTER (
        WHERE (COALESCE(${people.rescoreFromDate},
                        (${people.rescoreDueDate} - make_interval(days => ${rescoreWindowDays}))::date)
               + make_interval(days => ${newWindowDays}))::date < CURRENT_DATE
      )::int`,
    })
    .from(people)
    .where(and(
      eq(people.needsRescore, true),
      sql`${people.rescoreDueDate} IS NOT NULL`,
    ));

  return { affected: row?.affected ?? 0, newlyOverdue: row?.newlyOverdue ?? 0 };
}

/**
 * Move every queued teacher's deadline to `newWindowDays` after the
 * walkthrough that flagged them.
 *
 * Measured from the observation rather than from the existing due date, so
 * repeated changes do not compound — going 2 → 3 → 2 weeks lands back where it
 * started rather than drifting.
 */
export async function recalculateRescoreDueDates(newWindowDays: number): Promise<number> {
  const { rescoreWindowDays } = await getWindows();

  const result = await db.execute(sql`
    UPDATE people
       SET rescore_due_date = (COALESCE(rescore_from_date,
                                        (rescore_due_date - make_interval(days => ${rescoreWindowDays}))::date)
                               + make_interval(days => ${newWindowDays}))::date,
           rescore_from_date = COALESCE(rescore_from_date,
                                        (rescore_due_date - make_interval(days => ${rescoreWindowDays}))::date),
           updated_at = now()
     WHERE needs_rescore = true
       AND rescore_due_date IS NOT NULL
  `);
  return result.rowCount ?? 0;
}

/**
 * How many teachers would newly appear in Overdue Observations if the window
 * shortened to `newWindowDays`.
 *
 * Nothing is stored per teacher for this list — it is derived from each
 * teacher's most recent observation — so shortening it moves no deadline and
 * loses no data. It does change what every coach sees the next morning, which
 * is why it is still worth asking about.
 */
export async function previewOverdueChange(newWindowDays: number): Promise<{ newlyListed: number }> {
  const { overdueWindowDays } = await getWindows();
  if (newWindowDays >= overdueWindowDays) return { newlyListed: 0 };

  const rows = await db.execute<{ newly_listed: number }>(sql`
    WITH last_seen AS (
      SELECT p.employee_id,
             MAX(o.date) AS last_observed
        FROM people p
        JOIN schools s ON s.id = p.school_id AND s.is_home_office = false
        LEFT JOIN observations o ON o.observed_employee_id = p.employee_id
       WHERE p.is_active = true
         AND p.include_in_feedback_tracker = true
       GROUP BY p.employee_id
    )
    SELECT count(*)::int AS newly_listed
      FROM last_seen
     WHERE last_observed IS NOT NULL
       AND last_observed <  CURRENT_DATE - make_interval(days => ${newWindowDays})
       AND last_observed >= CURRENT_DATE - make_interval(days => ${overdueWindowDays})
  `);

  return { newlyListed: Number(rows.rows[0]?.newly_listed ?? 0) };
}

/**
 * Work out, from scratch, whether a teacher belongs in the rescore queue.
 *
 * The create path decides this from the observation being written, which is
 * fine while observations only ever appear. Editing breaks that: a walkthrough
 * can stop being one, its date can move, or it can be reassigned to somebody
 * else — and none of those can be answered by looking at a single observation.
 *
 * So this asks the question the queue is actually meant to answer: given
 * everything on record for this teacher, does their most recent published
 * walkthrough this year fall below the threshold? Clearing and re-deriving is
 * both simpler and more truthful than trying to unpick which observation set
 * the flag.
 */
export async function recomputeRescoreForTeacher(
  employeeId: string,
  activeYearId: number,
  proficiencyThreshold = 0.7,
): Promise<void> {
  const rows = await db.execute<{ date: string; avg: number }>(sql`
    SELECT o.date, AVG(s.score)::float AS avg
      FROM observations o
      JOIN observation_scores s ON s.observation_id = o.id
     WHERE o.observed_employee_id = ${employeeId}
       AND o.school_year_id = ${activeYearId}
       AND o.is_walkthrough = true
       AND o.status = 'published'
     GROUP BY o.id, o.date
     ORDER BY o.date DESC, o.id DESC
     LIMIT 1
  `);

  const latest = rows.rows[0];

  if (!latest || Number(latest.avg) >= proficiencyThreshold) {
    await db.execute(sql`
      UPDATE people
         SET needs_rescore = false, rescore_due_date = NULL,
             rescore_from_date = NULL, rescore_school_year_id = NULL,
             updated_at = now()
       WHERE employee_id = ${employeeId}
         AND needs_rescore = true
    `);
    return;
  }

  const { rescoreWindowDays } = await getWindows();
  await db.execute(sql`
    UPDATE people
       SET needs_rescore = true,
           rescore_from_date = ${latest.date}::date,
           rescore_due_date = (${latest.date}::date + make_interval(days => ${rescoreWindowDays}))::date,
           rescore_school_year_id = ${activeYearId},
           updated_at = now()
     WHERE employee_id = ${employeeId}
  `);
}
