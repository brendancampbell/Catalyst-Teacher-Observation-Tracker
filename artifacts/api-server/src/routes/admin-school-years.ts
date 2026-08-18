import { Router } from "express";
import { db, pool } from "@workspace/db";
import { schoolYears, rubricSets } from "@workspace/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { requireNetworkAdmin } from "../middleware/auth";
import { invalidateActiveSchoolYearCache } from "../lib/active-school-year";
import { yearHasRoster } from "../lib/roster";
import { dashboardCache } from "./dashboard";
import { districtCache } from "./district";
import { networkAvgsCache } from "./action-center";

function invalidateAnalyticsCaches() {
  dashboardCache.invalidatePrefix("dashboard:");
  districtCache.invalidatePrefix("district:");
  networkAvgsCache.invalidatePrefix("network-avgs:");
}

const router = Router();

router.use(requireNetworkAdmin);

/* GET /api/admin/school-years — list all school years in user-defined order */
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(schoolYears).orderBy(asc(schoolYears.displayOrder), asc(schoolYears.id));
    res.json(rows);
  } catch (err) {
    console.error("GET /admin/school-years error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PUT /api/admin/school-years/reorder — persist drag-and-drop order */
router.put("/reorder", async (req, res) => {
  try {
    const items = req.body as { id: number; displayOrder: number }[];
    if (!Array.isArray(items) || items.some((i) => typeof i.id !== "number" || typeof i.displayOrder !== "number")) {
      res.status(400).json({ error: "Body must be [{ id, displayOrder }]" });
      return;
    }
    await db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .update(schoolYears)
          .set({ displayOrder: item.displayOrder })
          .where(eq(schoolYears.id, item.id));
      }
    });
    const rows = await db.select().from(schoolYears).orderBy(asc(schoolYears.displayOrder), asc(schoolYears.id));
    res.json(rows);
  } catch (err) {
    console.error("PUT /admin/school-years/reorder error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/admin/school-years — create a new school year (always inactive, placed at top) */
router.post("/", async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    await db.update(schoolYears).set({ displayOrder: sql`display_order + 1` });
    const [row] = await db
      .insert(schoolYears)
      .values({ name: name.trim(), status: "inactive", displayOrder: 0 })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("POST /admin/school-years error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /api/admin/school-years/:id/rubric-sets — rubric sets belonging to a year */
router.get("/:id/rubric-sets", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const rows = await db
      .select()
      .from(rubricSets)
      .where(eq(rubricSets.schoolYearId, id))
      .orderBy(asc(rubricSets.displayOrder));
    res.json(rows);
  } catch (err) {
    console.error("GET /admin/school-years/:id/rubric-sets error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /api/admin/school-years/:id/activation-preview
   Counts open data in the CURRENTLY ACTIVE year that would become hidden
   if the admin switches to year :id. */
router.get("/:id/activation-preview", async (req, res) => {
  try {
    const [activeYear] = await db
      .select()
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);

    if (!activeYear) {
      res.json({
        openDrafts: 0, unresolvedActionSteps: 0, rescoreQueueItems: 0,
        schoolsAffected: 0, activeYearName: null, activeYearId: null,
      });
      return;
    }

    const client = await pool.connect();
    try {
      const draftsRes = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM observations
         WHERE school_year_id = $1 AND status = 'draft'`,
        [activeYear.id],
      );
      const actionRes = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM action_steps
         WHERE school_year_id = $1 AND status = 'open'`,
        [activeYear.id],
      );
      const rescoreRes = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM people
         WHERE rescore_school_year_id = $1`,
        [activeYear.id],
      );
      const schoolsRes = await client.query<{ count: number }>(
        `SELECT COUNT(DISTINCT school_id)::int AS count FROM (
           SELECT school_id FROM observations
             WHERE school_year_id = $1 AND status = 'draft' AND school_id IS NOT NULL
           UNION
           SELECT snapshot_school_id AS school_id FROM action_steps
             WHERE school_year_id = $1 AND status = 'open' AND snapshot_school_id IS NOT NULL
         ) combined`,
        [activeYear.id],
      );

      res.json({
        openDrafts:            Number(draftsRes.rows[0]?.count  ?? 0),
        unresolvedActionSteps: Number(actionRes.rows[0]?.count  ?? 0),
        rescoreQueueItems:     Number(rescoreRes.rows[0]?.count ?? 0),
        schoolsAffected:       Number(schoolsRes.rows[0]?.count ?? 0),
        activeYearName:        activeYear.name,
        activeYearId:          activeYear.id,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("GET /admin/school-years/:id/activation-preview error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Activation preconditions ─────────────────────────────────────
   Three things must be true before a year can go live. All three exist
   because of the same incident: activating a year with no roster made
   checkActiveThisYear() false for every user at once, which 403'd the
   entire app including the admin who did it.

     hasRoster      the year has at least one open assignment. This is the
                    empty-year state that caused the outage.
     hasRubricSet   the year has an active, non-archived rubric set.
                    Without one people can sign in but nothing can be
                    scored, which looks like a different bug entirely.

   There was a third — that the activating admin hold an assignment in the
   target year — to make self-lockout impossible. It is gone because
   NETWORK_ADMIN is now active in every year unconditionally
   (checkActiveThisYear), so there is no lockout left to prevent and the
   precondition only forced admins onto every roster to administer it. */
interface ActivationReadiness {
  ready:         boolean;
  hasRoster:     boolean;
  hasRubricSet:  boolean;
  blockers:      string[];
}

async function checkActivationReadiness(
  targetYearId: number,
): Promise<ActivationReadiness> {
  const [hasRoster, rubricRows] = await Promise.all([
    yearHasRoster(targetYearId),
    db.select({ id: rubricSets.id })
      .from(rubricSets)
      .where(and(
        eq(rubricSets.schoolYearId, targetYearId),
        eq(rubricSets.isActive, true),
        eq(rubricSets.isArchived, false),
      ))
      .limit(1),
  ]);
  const hasRubricSet = rubricRows.length > 0;

  const blockers: string[] = [];
  if (!hasRoster) {
    blockers.push("No roster has been loaded for this year — upload the staff list before activating");
  }
  if (!hasRubricSet) {
    blockers.push("This year has no active rubric set — copy one forward before activating");
  }

  return {
    ready: hasRoster && hasRubricSet,
    hasRoster,
    hasRubricSet,
    blockers,
  };
}

/* GET /api/admin/school-years/:id/readiness — what still blocks activation */
router.get("/:id/readiness", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    res.json(await checkActivationReadiness(id));
  } catch (err) {
    console.error("GET /admin/school-years/:id/readiness error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/admin/school-years/:id/activate — make exactly one year active

   Also applies every effect a staged roster deferred. A roster upload for a
   future year writes assignment rows and nothing else; the person-level
   consequences all land here, atomically, at the moment the year turns:

     • staff absent from the new year's roster are deactivated
     • staged new hires, created inert, become active
     • denormalised people.role / people.school_id are re-synced from the
       new year's assignments

   Rolling back is re-running this for the previous year. That works because
   activating a year restores the roster OF that year: a departure's
   assignment row is reopened, and reopening it makes them active again. */
router.post("/:id/activate", async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (Number.isNaN(targetId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [target] = await db
      .select()
      .from(schoolYears)
      .where(eq(schoolYears.id, targetId))
      .limit(1);
    if (!target) { res.status(404).json({ error: "School year not found" }); return; }

    if (target.status === "active") {
      res.json(target);
      return;
    }

    const readiness = await checkActivationReadiness(targetId);
    if (!readiness.ready) {
      res.status(409).json({
        error: "This school year is not ready to be activated",
        code:  "NOT_READY_TO_ACTIVATE",
        ...readiness,
      });
      return;
    }

    const [outgoing] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(eq(schoolYears.status, "active"))
      .limit(1);
    const outgoingId = outgoing?.id ?? null;

    const flipDate = new Date().toISOString().slice(0, 10);
    let deactivated = 0;
    let reactivated = 0;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      /* ── 1. Restore the target year's roster ──────────────────────
         Reopen assignments that a previous flip end-dated, so rolling
         back to a year brings back the people who were rostered for it.

         Only fires when the user has NO open assignment in the year, so a
         mid-year school change (old row closed, new row open) is untouched.
         Mid-year terminations are also safe: toggle-active flips
         people.is_active and never end-dates assignments, so a terminated
         person's row is still open and is skipped here.                */
      const reopened = await client.query<{ user_id: string }>(
        `UPDATE assignments a
            SET end_date = NULL, updated_at = now()
          WHERE a.school_year_id = $1
            AND a.end_date IS NOT NULL
            AND NOT EXISTS (
                  SELECT 1 FROM assignments o
                   WHERE o.user_id = a.user_id
                     AND o.school_year_id = $1
                     AND o.end_date IS NULL)
            AND a.id = (
                  SELECT b.id FROM assignments b
                   WHERE b.user_id = a.user_id
                     AND b.school_year_id = $1
                   ORDER BY b.start_date DESC, b.id DESC
                   LIMIT 1)
        RETURNING a.user_id`,
        [targetId],
      );
      const reopenedUserIds = reopened.rows.map((r) => r.user_id);

      /* ── 2. Flip the active year ── */
      await client.query(`UPDATE school_years SET status = 'inactive', updated_at = now()`);
      await client.query(`UPDATE school_years SET status = 'active', updated_at = now() WHERE id = $1`, [targetId]);

      /* ── 3. Departures ───────────────────────────────────────────
         Anyone holding an open assignment in the outgoing year with none
         in the incoming year has left. Computed, never stored — the
         roster states who is present, and departure is the absence of a
         statement about them.                                          */
      if (outgoingId !== null && outgoingId !== targetId) {
        const departed = await client.query(
          `WITH departed AS (
             SELECT a.id, a.user_id
               FROM assignments a
               JOIN people p ON p.employee_id = a.user_id
              WHERE a.school_year_id = $1
                AND a.end_date IS NULL
                /* Admins are active in every year and are not rostered, so
                   absence from a roster says nothing about them. Without
                   this, the first flip would deactivate every admin. */
                AND p.role <> 'NETWORK_ADMIN'
                AND NOT EXISTS (
                      SELECT 1 FROM assignments t
                       WHERE t.user_id = a.user_id
                         AND t.school_year_id = $2
                         AND t.end_date IS NULL)
           ), closed AS (
             UPDATE assignments SET end_date = $3, updated_at = now()
              WHERE id IN (SELECT id FROM departed)
           )
           UPDATE people
              SET is_active = false, updated_at = now()
            WHERE employee_id IN (SELECT user_id FROM departed)
              AND is_active = true`,
          [outgoingId, targetId, flipDate],
        );
        deactivated = departed.rowCount ?? 0;
      }

      /* ── 4a. Re-sync the denormalised fields school scoping reads ──
         Deferred to here so staging a roster never disturbs the year that
         is still running. Deliberately does NOT touch is_active — see 4b. */
      await client.query(
        `UPDATE people p
            SET role      = a.role,
                school_id = a.school_id,
                updated_at = now()
           FROM assignments a
          WHERE a.user_id = p.employee_id
            AND a.school_year_id = $1
            AND a.end_date IS NULL
            AND (p.role <> a.role
                 OR p.school_id IS DISTINCT FROM a.school_id)`,
        [targetId],
      );

      /* ── 4b. Reactivate, narrowly ────────────────────────────────
         Only two groups get is_active flipped back on, because "has an
         open assignment in the new year" is too broad a rule: someone
         terminated mid-year still holds an open assignment (toggle-active
         never end-dates one), and a blanket rule would resurrect them
         every time a year was activated.

           • users whose assignment this activation just reopened — by
             construction, exactly the people a previous flip deactivated
           • staged new hires: created inert by a roster upload, holding an
             open assignment in the incoming year and none at all in the
             outgoing one                                               */
      const reactivatedRes = await client.query(
        `UPDATE people p
            SET is_active = true, updated_at = now()
          WHERE p.is_active = false
            AND EXISTS (
                  SELECT 1 FROM assignments a
                   WHERE a.user_id = p.employee_id
                     AND a.school_year_id = $1
                     AND a.end_date IS NULL)
            AND (
                  p.employee_id = ANY($2::text[])
                  OR ($3::int IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM assignments o
                         WHERE o.user_id = p.employee_id
                           AND o.school_year_id = $3))
                )`,
        [targetId, reopenedUserIds, outgoingId],
      );
      reactivated = reactivatedRes.rowCount ?? 0;

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    invalidateActiveSchoolYearCache();
    invalidateAnalyticsCaches();

    const [updated] = await db
      .select()
      .from(schoolYears)
      .where(eq(schoolYears.id, targetId))
      .limit(1);
    res.json({ ...updated, deactivated, reactivated, outgoingYearId: outgoingId });
  } catch (err) {
    console.error("POST /admin/school-years/:id/activate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
