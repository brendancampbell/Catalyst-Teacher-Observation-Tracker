import { Router } from "express";
import { db } from "@workspace/db";
import { observationScores, observations, teachers, users, schools } from "@workspace/db/schema";
import { ne } from "drizzle-orm";
import { requireNetworkAdmin } from "../middleware/auth";

const router = Router();

/* ── POST /api/maintenance/reset-test-data ───────────────────────
   One-time cleanup: removes all test/seed data from production.
   Keeps only bcampbell@uncommonschools.org and the rubric structure.
   NETWORK_ADMIN only. Remove this route after use.               */
router.post("/reset-test-data", requireNetworkAdmin, async (_req, res) => {
  try {
    const scoresDel  = await db.delete(observationScores).returning({ id: observationScores.id });
    const obsDel     = await db.delete(observations).returning({ id: observations.id });
    const teacherDel = await db.delete(teachers).returning({ id: teachers.id });
    const usersDel   = await db.delete(users)
      .where(ne(users.email, "bcampbell@uncommonschools.org"))
      .returning({ id: users.id });
    const schoolsDel = await db.delete(schools).returning({ id: schools.id });

    res.json({
      deleted: {
        observationScores: scoresDel.length,
        observations:      obsDel.length,
        teachers:          teacherDel.length,
        users:             usersDel.length,
        schools:           schoolsDel.length,
      },
    });
  } catch (err) {
    console.error("reset-test-data error:", err);
    res.status(500).json({ error: "Reset failed", detail: String(err) });
  }
});

export default router;
