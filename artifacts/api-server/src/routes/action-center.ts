import { Router } from "express";
import { db } from "@workspace/db";
import { teachers, schools } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireNetworkScope } from "../middleware/auth";

const router = Router();

/* ── GET /api/action-center/network ──────────────────────────────
   Network action center — NETWORK_LEADER and NETWORK_ADMIN only.   */
router.get("/network", requireNetworkScope, async (_req, res) => {
  try {
    const rows = await db
      .select({
        teacherId:      teachers.id,
        teacherFirst:   teachers.firstName,
        teacherLast:    teachers.lastName,
        subject:        teachers.subject,
        gradeLevel:     teachers.gradeLevel,
        schoolName:     schools.name,
        rescoreDueDate: teachers.rescoreDueDate,
        needsRescore:   teachers.needsRescore,
      })
      .from(teachers)
      .leftJoin(schools, eq(teachers.schoolId, schools.id))
      .where(eq(teachers.needsRescore, true))
      .orderBy(teachers.rescoreDueDate);

    res.json(rows.map((r) => ({
      ...r,
      teacherName: `${r.teacherFirst} ${r.teacherLast}`.trim(),
    })));
  } catch (err) {
    console.error("GET /action-center/network error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/action-center/rescore-queue ───────────────────────────
   Returns teachers in rescore queue. School-scoped users see only
   their school; network-scoped users see all schools.               */
router.get("/rescore-queue", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const isNetworkScope = user.role === "NETWORK_LEADER" || user.role === "NETWORK_ADMIN";

    const rows = await db
      .select({
        teacherId:      teachers.id,
        teacherFirst:   teachers.firstName,
        teacherLast:    teachers.lastName,
        subject:        teachers.subject,
        gradeLevel:     teachers.gradeLevel,
        schoolName:     schools.name,
        rescoreDueDate: teachers.rescoreDueDate,
        needsRescore:   teachers.needsRescore,
      })
      .from(teachers)
      .leftJoin(schools, eq(teachers.schoolId, schools.id))
      .where(
        isNetworkScope
          ? eq(teachers.needsRescore, true)
          : and(eq(teachers.needsRescore, true), eq(teachers.schoolId, user.schoolId!)),
      )
      .orderBy(teachers.rescoreDueDate);

    res.json(rows.map((r) => ({
      ...r,
      teacherName: `${r.teacherFirst} ${r.teacherLast}`.trim(),
    })));
  } catch (err) {
    console.error("GET /action-center/rescore-queue error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
