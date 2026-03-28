import { Router } from "express";
import { db } from "@workspace/db";
import {
  schools, teachers, rubricQuarters, rubricCategories,
  observations, observationScores,
} from "@workspace/db/schema";
import { eq, inArray, and, isNotNull } from "drizzle-orm";

const router = Router();

/* ── GET /api/district/summary?quarter=Q1&scoreType=recent|average&walkthroughsOnly=true
   Returns per-school average scores for each domain.
   scoreType=recent       → most-recent score per teacher per domain
   scoreType=average      → average ALL observations for the quarter
   walkthroughsOnly=true  → restrict to is_walkthrough observations only  */
router.get("/summary", async (req, res) => {
  try {
    const quarterSlug      = (req.query.quarter   as string) || "Q1";
    const scoreType        = (req.query.scoreType as string) === "average" ? "average" : "recent";
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
      with: { domains: { orderBy: (d, { asc }) => [asc(d.displayOrder)] } },
    });

    const allSchools  = await db.select().from(schools).orderBy(schools.name);
    const allTeachers = await db
      .select()
      .from(teachers)
      .where(and(eq(teachers.isActive, true), isNotNull(teachers.schoolId)));

    const obsWhere = walkthroughsOnly
      ? and(eq(observations.quarterId, quarter.id), eq(observations.isWalkthrough, true))
      : eq(observations.quarterId, quarter.id);

    const allObs = await db.select().from(observations).where(obsWhere);

    const obsIds    = allObs.map((o) => o.id);
    const allScores = obsIds.length > 0
      ? await db.select().from(observationScores).where(inArray(observationScores.observationId, obsIds))
      : [];

    /* Build lookup: observationId → { domainSlug → score } */
    const scoresByObs = new Map<number, Record<string, number>>();
    for (const s of allScores) {
      if (!scoresByObs.has(s.observationId)) scoresByObs.set(s.observationId, {});
      scoresByObs.get(s.observationId)![s.domainSlug] = s.score;
    }

    /* Build lookup: teacherId → sorted observations (newest first) */
    const obsByTeacher = new Map<number, typeof allObs>();
    for (const o of allObs) {
      if (!obsByTeacher.has(o.teacherId)) obsByTeacher.set(o.teacherId, []);
      obsByTeacher.get(o.teacherId)!.push(o);
    }
    for (const [, obs] of obsByTeacher) obs.sort((a, b) => b.date.localeCompare(a.date));

    const allDomains = categories.flatMap((c) => c.domains ?? []);
    const allSlugs   = allDomains.map((d) => d.slug);

    /* ── Per-school aggregation ───────────────────────────── */
    const schoolRows = allSchools.map((school) => {
      const schoolTeachers = allTeachers.filter((t) => t.schoolId === school.id);
      const domainSums:   Record<string, number> = {};
      const domainCounts: Record<string, number> = {};

      for (const t of schoolTeachers) {
        const obs = obsByTeacher.get(t.id) ?? [];
        if (obs.length === 0) continue;

        if (scoreType === "recent") {
          /* Most-recent score per domain: iterate observations newest-first.
             For each domain, stop at the first observation that scored it.  */
          for (const slug of allSlugs) {
            for (const o of obs) {
              const scores = scoresByObs.get(o.id) ?? {};
              const v = scores[slug];
              if (v != null) {
                domainSums[slug]   = (domainSums[slug]   ?? 0) + v;
                domainCounts[slug] = (domainCounts[slug] ?? 0) + 1;
                break;
              }
            }
          }
        } else {
          /* Quarter average: average ALL observations for this teacher first */
          const teacherDomainSums:   Record<string, number> = {};
          const teacherDomainCounts: Record<string, number> = {};
          for (const o of obs) {
            const scores = scoresByObs.get(o.id) ?? {};
            for (const slug of allSlugs) {
              const v = scores[slug];
              if (v != null) {
                teacherDomainSums[slug]   = (teacherDomainSums[slug]   ?? 0) + v;
                teacherDomainCounts[slug] = (teacherDomainCounts[slug] ?? 0) + 1;
              }
            }
          }
          /* Contribute the teacher's per-domain average to the school total */
          for (const slug of allSlugs) {
            const cnt = teacherDomainCounts[slug] ?? 0;
            if (cnt > 0) {
              domainSums[slug]   = (domainSums[slug]   ?? 0) + teacherDomainSums[slug] / cnt;
              domainCounts[slug] = (domainCounts[slug] ?? 0) + 1;
            }
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
          totalSum   += avg;
          totalCount += 1;
        } else {
          domainAverages[slug] = null;
        }
      }

      const overall = totalCount > 0
        ? Math.round((totalSum / totalCount) * 10) / 10
        : null;

      return {
        id:            school.id,
        name:          school.name,
        region:        school.region ?? null,
        gradeSpan:     school.gradeSpan ?? null,
        teacherCount:  schoolTeachers.length,
        observedCount: schoolTeachers.filter((t) => (obsByTeacher.get(t.id) ?? []).length > 0).length,
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
