import { Router } from "express";
import { db } from "@workspace/db";
import {
  teachers, rubricQuarters, rubricCategories,
  observations, observationScores,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const router = Router();

/* ── GET /api/dashboard?quarter=Q1 ──────────────────────────────────
   Returns rubric + all teachers with full observation history.        */
router.get("/", async (req, res) => {
  try {
    const quarterSlug = (req.query.quarter as string) || "Q1";

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

    const allTeachers = await db.select().from(teachers);

    const allObs = await db.select().from(observations)
      .where(eq(observations.quarterId, quarter.id));

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
      id: String(t.id),
      name: t.name,
      department: t.department,
      gradeLevel: t.gradeLevel,
      observations: (obsByTeacher.get(t.id) ?? [])
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((o) => ({
          id: String(o.id),
          date: o.date,
          strengths: o.strengths ?? undefined,
          growthAreas: o.growthAreas ?? undefined,
          observer: o.observer,
          scores: scoresByObs.get(o.id) ?? {},
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
