import { Router } from "express";
import { db } from "@workspace/db";
import {
  schools, people, rubricSets, rubricCategories,
  observations, observationScores,
} from "@workspace/db/schema";
import { eq, inArray, and, isNotNull, desc } from "drizzle-orm";
import { TtlCache } from "../lib/ttl-cache";

/* District summary loads every teacher + observation + score in memory to
   compute per-school aggregates.  Cache the final aggregate for 2 minutes. */
const districtCache = new TtlCache<object>(2 * 60 * 1000, 5 * 60 * 1000);

const router = Router();

/* ── GET /api/district/summary?rubricSet=Q1&scoreType=recent|average&walkthroughsOnly=true
   Accepts legacy param `quarter` as fallback for backward compat.

   SCENARIO A (target=TEACHER): per-school average scores via teacher rollup.
     scoreType=recent  → most-recent score per teacher per domain
     scoreType=average → average ALL observations for the rubric set
     walkthroughsOnly=true → restrict to is_walkthrough observations only

   SCENARIO B (target=SCHOOL): returns raw scores from the most recent
     school-wide observation per campus. No teacher rollup.              */
router.get("/summary", async (req, res) => {
  try {
    const setSlug          = (req.query.rubricSet as string) || (req.query.quarter as string) || "Q1";
    const scoreType        = (req.query.scoreType as string) === "average" ? "average" : "recent";
    const walkthroughsOnly = req.query.walkthroughsOnly === "true";

    const rubricSet = await db.query.rubricSets.findFirst({
      where: eq(rubricSets.slug, setSlug),
    });
    if (!rubricSet) {
      res.status(404).json({ error: `Rubric set '${setSlug}' not found` });
      return;
    }

    /* ── Cache check ──────────────────────────────────────────────────
       The summary aggregates every teacher + observation + score across
       the network.  Cache the finished aggregate per unique param set.  */
    const cacheKey = `district:${rubricSet.slug}:${scoreType}:wt=${walkthroughsOnly}`;
    {
      const hit = districtCache.get(cacheKey);
      if (hit) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }
    }

    const categories = await db.query.rubricCategories.findMany({
      where: eq(rubricCategories.rubricSetId, rubricSet.id),
      orderBy: (c, { asc }) => [asc(c.displayOrder)],
      with: { domains: { orderBy: (d, { asc }) => [asc(d.displayOrder)] } },
    });

    const allSchools  = await db.select().from(schools).orderBy(schools.displayName);
    const allDomains  = categories.flatMap((c) => c.domains ?? []);
    const allSlugs    = allDomains.map((d) => d.slug);

    const rubricSetInfo = {
      id:       rubricSet.id,
      slug:     rubricSet.slug,
      name:     rubricSet.name,
      gradeSpan: rubricSet.gradeSpan ?? null,
      target:   rubricSet.target,
    };

    const categoriesOut = categories.map((cat) => ({
      id:      `cat_${cat.id}`,
      label:   cat.name,
      domains: (cat.domains ?? []).map((d) => ({ id: d.slug, label: d.name, description: d.description ?? undefined })),
    }));

    /* ══ SCENARIO B — School-target rubric ════════════════════════ */
    if (rubricSet.target === "SCHOOL") {
      const schoolObs = await db
        .select()
        .from(observations)
        .where(and(eq(observations.rubricSetId, rubricSet.id), eq(observations.target, "SCHOOL"), isNotNull(observations.schoolId)))
        .orderBy(desc(observations.date));

      /* Group ALL observations by school */
      const obsBySchool = new Map<number, typeof schoolObs>();
      for (const obs of schoolObs) {
        if (!obs.schoolId) continue;
        if (!obsBySchool.has(obs.schoolId)) obsBySchool.set(obs.schoolId, []);
        obsBySchool.get(obs.schoolId)!.push(obs);
      }

      /* Fetch scores for every school observation */
      const allSchoolObsIds = schoolObs.map((o) => o.id);
      const allSchoolScores = allSchoolObsIds.length > 0
        ? await db.select().from(observationScores).where(inArray(observationScores.observationId, allSchoolObsIds))
        : [];

      const scoresByObs = new Map<number, Record<string, number>>();
      for (const s of allSchoolScores) {
        if (!scoresByObs.has(s.observationId)) scoresByObs.set(s.observationId, {});
        scoresByObs.get(s.observationId)![s.domainSlug] = s.score;
      }

      const schoolRows = allSchools.map((school) => {
        const obsArr = obsBySchool.get(school.id) ?? [];

        /* Average all observations per domain */
        const domainSums:   Record<string, number> = {};
        const domainCounts: Record<string, number> = {};
        for (const obs of obsArr) {
          const scores = scoresByObs.get(obs.id) ?? {};
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
            totalSum   += avg;
            totalCount += 1;
          } else {
            domainAverages[slug] = null;
          }
        }

        const mostRecentDate = obsArr.length > 0
          ? obsArr.reduce((a, b) => a.date > b.date ? a : b).date
          : null;

        return {
          id:               school.id,
          name:             school.displayName,
          abbreviation:     school.abbreviation ?? null,
          region:           school.region ?? null,
          gradeSpan:        school.gradeSpan ?? null,
          teacherCount:     0,
          observedCount:    obsArr.length,
          domainAverages,
          overall:          totalCount > 0 ? Math.round((totalSum / totalCount) * 10) / 10 : null,
          lastObservedDate: mostRecentDate,
        };
      });

      const resultB = { rubricSet: rubricSetInfo, categories: categoriesOut, schools: schoolRows };
      districtCache.set(cacheKey, resultB);
      res.setHeader("X-Cache", "MISS");
      res.json(resultB);
      return;
    }

    /* ══ SCENARIO A — Teacher-target rubric (original logic) ══════ */
    const allTeachers = await db
      .select()
      .from(people)
      .where(and(eq(people.isActive, true), isNotNull(people.schoolId), eq(people.includeInFeedbackTracker, true)));

    const obsWhere = walkthroughsOnly
      ? and(eq(observations.rubricSetId, rubricSet.id), eq(observations.isWalkthrough, true), eq(observations.target, "TEACHER"))
      : and(eq(observations.rubricSetId, rubricSet.id), eq(observations.target, "TEACHER"));

    const allObs = await db.select().from(observations).where(obsWhere);

    const obsIds    = allObs.map((o) => o.id);
    const allScores = obsIds.length > 0
      ? await db.select().from(observationScores).where(inArray(observationScores.observationId, obsIds))
      : [];

    const scoresByObs = new Map<number, Record<string, number>>();
    for (const s of allScores) {
      if (!scoresByObs.has(s.observationId)) scoresByObs.set(s.observationId, {});
      scoresByObs.get(s.observationId)![s.domainSlug] = s.score;
    }

    const obsByTeacher = new Map<string, typeof allObs>();
    for (const o of allObs) {
      if (!o.observedEmployeeId) continue;
      if (!obsByTeacher.has(o.observedEmployeeId)) obsByTeacher.set(o.observedEmployeeId, []);
      obsByTeacher.get(o.observedEmployeeId)!.push(o);
    }
    for (const [, obs] of obsByTeacher) obs.sort((a, b) => b.date.localeCompare(a.date));

    const schoolRows = allSchools.map((school) => {
      const schoolTeachers = allTeachers.filter((t) => t.schoolId === school.id);
      const domainSums:   Record<string, number> = {};
      const domainCounts: Record<string, number> = {};

      for (const t of schoolTeachers) {
        const obs = obsByTeacher.get(t.employeeId) ?? [];
        if (obs.length === 0) continue;

        if (scoreType === "recent") {
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
        id:               school.id,
        name:             school.displayName,
        abbreviation:     school.abbreviation ?? null,
        region:           school.region ?? null,
        gradeSpan:        school.gradeSpan ?? null,
        teacherCount:     schoolTeachers.length,
        observedCount:    schoolTeachers.filter((t) => (obsByTeacher.get(t.employeeId) ?? []).length > 0).length,
        domainAverages,
        overall,
        lastObservedDate: null,
      };
    });

    const resultA = { rubricSet: rubricSetInfo, categories: categoriesOut, schools: schoolRows };
    districtCache.set(cacheKey, resultA);
    res.setHeader("X-Cache", "MISS");
    res.json(resultA);
  } catch (err) {
    console.error("GET /district/summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
