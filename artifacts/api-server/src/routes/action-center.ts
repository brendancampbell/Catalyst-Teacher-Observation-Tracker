import { Router } from "express";
import { db } from "@workspace/db";
import { teachers, schools } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/* ── GET /api/action-center/rescore-queue ───────────────────────────
   Returns all teachers where needsRescore === true, with school name
   and due date info.                                                  */
router.get("/rescore-queue", async (req, res) => {
  try {
    const rows = await db
      .select({
        teacherId:      teachers.id,
        teacherName:    teachers.name,
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

    res.json(rows);
  } catch (err) {
    console.error("GET /action-center/rescore-queue error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
