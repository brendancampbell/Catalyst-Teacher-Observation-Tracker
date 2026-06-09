import { Router } from "express";
import { db } from "@workspace/db";
import { teachers, schools, observations } from "@workspace/db/schema";
import { eq, and, max, sql } from "drizzle-orm";
import { requireNetworkScope, effectiveSchoolId, NoSchoolAssignedError } from "../middleware/auth";

const router = Router();

async function assertSchoolExists(id: number): Promise<boolean> {
  const rows = await db.select({ id: schools.id }).from(schools).where(eq(schools.id, id)).limit(1);
  return rows.length > 0;
}

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
   their school; network-scoped users see all schools (or a specific
   school when ?schoolId= is provided).                              */
router.get("/rescore-queue", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" });
      return;
    }
    if (requested !== null && !(await assertSchoolExists(requested))) {
      res.status(404).json({ error: "School not found" });
      return;
    }
    const scopedSchoolId = effectiveSchoolId(user, requested);

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
        scopedSchoolId !== null
          ? and(eq(teachers.needsRescore, true), eq(teachers.schoolId, scopedSchoolId))
          : eq(teachers.needsRescore, true),
      )
      .orderBy(teachers.rescoreDueDate);

    res.json(rows.map((r) => ({
      ...r,
      teacherName: `${r.teacherFirst} ${r.teacherLast}`.trim(),
    })));
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message });
      return;
    }
    console.error("GET /action-center/rescore-queue error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/action-center/overdue-observations ────────────────────
   Teachers not observed in the last 14 days (or never observed).
   School users see only their school; network users see all (or a
   specific school when ?schoolId= is provided).                     */
router.get("/overdue-observations", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" });
      return;
    }
    if (requested !== null && !(await assertSchoolExists(requested))) {
      res.status(404).json({ error: "School not found" });
      return;
    }
    const scopedSchoolId = effectiveSchoolId(user, requested);

    const schoolFilter = scopedSchoolId !== null
      ? sql`${teachers.schoolId} = ${scopedSchoolId}`
      : sql`1=1`;

    const rows = await db
      .select({
        teacherId:    teachers.id,
        teacherFirst: teachers.firstName,
        teacherLast:  teachers.lastName,
        subject:      teachers.subject,
        gradeLevel:   teachers.gradeLevel,
        schoolName:   schools.name,
        lastObserved: max(observations.date),
      })
      .from(teachers)
      .leftJoin(schools, eq(teachers.schoolId, schools.id))
      .leftJoin(observations, eq(observations.teacherId, teachers.id))
      .where(and(eq(teachers.isActive ?? sql`true`, true), schoolFilter))
      .groupBy(teachers.id, teachers.firstName, teachers.lastName, teachers.subject, teachers.gradeLevel, schools.name)
      .having(
        sql`MAX(${observations.date}) < CURRENT_DATE - INTERVAL '14 days' OR MAX(${observations.date}) IS NULL`,
      )
      .orderBy(sql`MAX(${observations.date}) ASC NULLS FIRST`);

    res.json(rows.map((r) => ({
      teacherId:    r.teacherId,
      teacherName:  `${r.teacherFirst} ${r.teacherLast}`.trim(),
      subject:      r.subject,
      gradeLevel:   r.gradeLevel,
      schoolName:   r.schoolName,
      lastObserved: r.lastObserved ?? null,
      daysSince:    r.lastObserved
        ? Math.floor((Date.now() - new Date(r.lastObserved).getTime()) / 86_400_000)
        : null,
    })));
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message });
      return;
    }
    console.error("GET /action-center/overdue-observations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
