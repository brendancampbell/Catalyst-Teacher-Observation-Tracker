import { Router } from "express";
import { db } from "@workspace/db";
import {
  teachers, rubricQuarters,
  observations, observationScores,
} from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";

const router = Router();

/* ── GET /api/teachers/:id?quarter=Q1 ───────────────────────────── */
router.get("/:id", async (req, res) => {
  try {
    const teacherId = Number(req.params.id);
    const quarterSlug = (req.query.quarter as string) || "Q1";

    const teacher = await db.query.teachers.findFirst({
      where: eq(teachers.id, teacherId),
    });
    if (!teacher) { res.status(404).json({ error: "Teacher not found" }); return; }

    /* School-scope check: COACH and SCHOOL_LEADER may only access their own school */
    const currentUser = req.user as Express.User;
    const isNetworkScope = currentUser.role === "NETWORK_ADMIN" || currentUser.role === "NETWORK_LEADER";
    if (!isNetworkScope && teacher.schoolId !== currentUser.schoolId) {
      res.status(403).json({ error: "Cannot access teachers from another school" });
      return;
    }

    const quarter = await db.query.rubricQuarters.findFirst({
      where: eq(rubricQuarters.slug, quarterSlug),
    });
    if (!quarter) { res.status(404).json({ error: "Quarter not found" }); return; }

    const obsRows = await db.select().from(observations)
      .where(and(eq(observations.teacherId, teacherId), eq(observations.rubricSetId, quarter.id)));

    const obsIds = obsRows.map((o) => o.id);
    const scores = obsIds.length > 0
      ? await db.select().from(observationScores).where(inArray(observationScores.observationId, obsIds))
      : [];

    const scoresByObs = new Map<number, Record<string, number>>();
    for (const s of scores) {
      if (!scoresByObs.has(s.observationId)) scoresByObs.set(s.observationId, {});
      scoresByObs.get(s.observationId)![s.domainSlug] = s.score;
    }

    res.json({
      id:         String(teacher.id),
      name:       `${teacher.firstName} ${teacher.lastName}`.trim(),
      firstName:  teacher.firstName,
      lastName:   teacher.lastName,
      employeeId: teacher.employeeId,
      email:      teacher.email,
      subject:    teacher.subject,
      gradeLevel: teacher.gradeLevel,
      observations: obsRows
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((o) => ({
          id: String(o.id),
          date: o.date,
          strengths: o.strengths ?? undefined,
          growthAreas: o.growthAreas ?? undefined,
          observer: o.observer,
          scores: scoresByObs.get(o.id) ?? {},
        })),
    });
  } catch (err) {
    console.error("GET /teachers/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
