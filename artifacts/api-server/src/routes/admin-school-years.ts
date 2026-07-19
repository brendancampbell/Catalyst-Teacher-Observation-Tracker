import { Router } from "express";
import { db, pool } from "@workspace/db";
import { schoolYears, rubricSets } from "@workspace/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import { requireNetworkAdmin } from "../middleware/auth";
import { invalidateActiveSchoolYearCache } from "../lib/active-school-year";
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

/* POST /api/admin/school-years/:id/activate — make exactly one year active */
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

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE school_years SET status = 'inactive'`);
      await client.query(`UPDATE school_years SET status = 'active' WHERE id = $1`, [targetId]);
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
    res.json(updated);
  } catch (err) {
    console.error("POST /admin/school-years/:id/activate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
