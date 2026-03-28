import { Router } from "express";
import { db } from "@workspace/db";
import {
  teachers, rubricQuarters, rubricCategories,
  observations, observationScores,
} from "@workspace/db/schema";
import { eq, inArray, and } from "drizzle-orm";

const router = Router();

/* ── GET /api/dashboard?quarter=Q1&schoolId=2&walkthroughsOnly=true ──
   Returns rubric + teachers with full observation history.
   When walkthroughsOnly=true, only observations where isWalkthrough
   is true are included in the response.                               */
router.get("/", async (req, res) => {
  try {
    const quarterSlug      = (req.query.quarter as string) || "Q1";
    const schoolIdParam    = req.query.schoolId ? Number(req.query.schoolId) : null;
    const walkthroughsOnly = req.query.walkthroughsOnly === "true";

    const quarter = await db.query.rubricQuarters.findFirst({
      where: eq(rubricQuarters.slug, quarterSlug),
    });
    if (!quarter) {
      res.status(404).json({ error: `Quarter '${quarterSlug}' not found` });
      return;
    }

    const categories = await db.query.rubricCategories.findMany({
      where: eq(rubricCategories.quarterId, quarter.id),
      orderBy: (c, { asc }) => [asc(c.displayOrder)],
      with: {
        domains: {
          orderBy: (d, { asc }) => [asc(d.displayOrder)],
        },
      },
    });

    const allTeachers = schoolIdParam != null
      ? await db.select().from(teachers).where(and(eq(teachers.isActive, true), eq(teachers.schoolId, schoolIdParam)))
      : await db.select().from(teachers).where(eq(teachers.isActive, true));

    const obsWhere = walkthroughsOnly
      ? and(eq(observations.quarterId, quarter.id), eq(observations.isWalkthrough, true))
      : eq(observations.quarterId, quarter.id);

    const allObs = await db.select().from(observations).where(obsWhere);

    const obsIds = allObs.map((o) => o.id);
    const allScores = obsIds.length > 0
      ? await db.select().from(observationScores).where(inArray(observationScores.observationId, obsIds))
      : [];

    const scoresByObs = new Map<number, Record<string, number>>();
    for (const s of allScores) {
      if (!scoresByObs.has(s.observationId)) scoresByObs.set(s.observationId, {});
      scoresByObs.get(s.observationId)![s.domainSlug] = s.score;
    }

    const obsByTeacher = new Map<number, typeof allObs>();
    for (const o of allObs) {
      if (!obsByTeacher.has(o.teacherId)) obsByTeacher.set(o.teacherId, []);
      obsByTeacher.get(o.teacherId)!.push(o);
    }

    const teacherData = allTeachers.map((t) => ({
      id:             String(t.id),
      name:           t.name,
      subject:        t.subject,
      gradeLevel:     t.gradeLevel,
      schoolId:       t.schoolId,
      needsRescore:   t.needsRescore,
      rescoreDueDate: t.rescoreDueDate,
      observations:   (obsByTeacher.get(t.id) ?? [])
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((o) => ({
          id:            String(o.id),
          date:          o.date,
          isWalkthrough: o.isWalkthrough,
          strengths:     o.strengths ?? undefined,
          growthAreas:   o.growthAreas ?? undefined,
          observer:      o.observer,
          scores:        scoresByObs.get(o.id) ?? {},
        })),
    }));

    res.json({
      quarter: { id: quarter.id, slug: quarter.slug, name: quarter.name },
      categories: categories.map((cat) => ({
        id: `cat_${cat.id}`,
        label: cat.name,
        domains: (cat.domains ?? []).map((d) => ({ id: d.slug, label: d.name })),
      })),
      teachers: teacherData,
    });
  } catch (err) {
    console.error("GET /dashboard error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
