import { Router } from "express";
import { db } from "@workspace/db";
import {
  schools, teachers, rubricQuarters, rubricCategories,
  observations, observationScores,
} from "@workspace/db/schema";
import { eq, inArray, and, isNotNull } from "drizzle-orm";

const router = Router();

/* ── GET /api/district/summary?quarter=Q1 ──────────────────────────
   Returns per-school average scores for each domain, using the most
   recent observation per teacher in the given quarter.             */
router.get("/summary", async (req, res) => {
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
      with: { domains: { orderBy: (d, { asc }) => [asc(d.displayOrder)] } },
    });

    const allSchools = await db.select().from(schools).orderBy(schools.name);

    /* Fetch all active teachers with their school */
    const allTeachers = await db
      .select()
      .from(teachers)
      .where(and(eq(teachers.isActive, true), isNotNull(teachers.schoolId)));

    /* Fetch all observations in this quarter */
    const allObs = await db
      .select()
      .from(observations)
      .where(eq(observations.quarterId, quarter.id));

    const obsIds = allObs.map((o) => o.id);
    const allScores = obsIds.length > 0
      ? await db.select().from(observationScores).where(inArray(observationScores.observationId, obsIds))
      : [];

    /* Build lookup: observationId → { domainSlug → score } */
    const scoresByObs = new Map<number, Record<string, number>>();
    for (const s of allScores) {
      if (!scoresByObs.has(s.observationId)) scoresByObs.set(s.observationId, {});
      scoresByObs.get(s.observationId)![s.domainSlug] = s.score;
    }

    /* Build lookup: teacherId → sorted observations (oldest first) */
    const obsByTeacher = new Map<number, typeof allObs>();
    for (const o of allObs) {
      if (!obsByTeacher.has(o.teacherId)) obsByTeacher.set(o.teacherId, []);
      obsByTeacher.get(o.teacherId)!.push(o);
    }
    for (const [, obs] of obsByTeacher) obs.sort((a, b) => b.date.localeCompare(a.date)); // newest first

    /* All domain slugs (ordered) */
    const allDomains = categories.flatMap((c) => c.domains ?? []);
    const allSlugs   = allDomains.map((d) => d.slug);

    /* Per-school: average the most-recent-observation scores for each teacher */
    const schoolRows = allSchools.map((school) => {
      const schoolTeachers = allTeachers.filter((t) => t.schoolId === school.id);
      const domainSums:  Record<string, number> = {};
      const domainCounts: Record<string, number> = {};

      for (const t of schoolTeachers) {
        const obs = obsByTeacher.get(t.id) ?? [];
        const mostRecent = obs[0];
        if (!mostRecent) continue;
        const scores = scoresByObs.get(mostRecent.id) ?? {};
        for (const slug of allSlugs) {
          const v = scores[slug];
          if (v != null) {
            domainSums[slug]   = (domainSums[slug]   ?? 0) + v;
            domainCounts[slug] = (domainCounts[slug] ?? 0) + 1;
          }
        }
      }

      const domainAverages: Record<string, number | null> = {};
      let totalSum = 0, totalCount = 0;
      for (const slug of allSlugs) {
        const cnt = domainCounts[slug] ?? 0;
        if (cnt > 0) {
          const avg = domainSums[slug] / cnt;
          domainAverages[slug] = Math.round(avg * 10) / 10;
          totalSum += domainSums[slug];
          totalCount += cnt;
        } else {
          domainAverages[slug] = null;
        }
      }

      const overall = totalCount > 0
        ? Math.round((totalSum / totalCount) * 10) / 10
        : null;

      return {
        id:             school.id,
        name:           school.name,
        teacherCount:   schoolTeachers.length,
        observedCount:  schoolTeachers.filter((t) => (obsByTeacher.get(t.id) ?? []).length > 0).length,
        domainAverages,
        overall,
      };
    });

    res.json({
      quarter:    { id: quarter.id, slug: quarter.slug, name: quarter.name },
      categories: categories.map((cat) => ({
        id:      `cat_${cat.id}`,
        label:   cat.name,
        domains: (cat.domains ?? []).map((d) => ({ id: d.slug, label: d.name })),
      })),
      schools: schoolRows,
    });
  } catch (err) {
    console.error("GET /district/summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
