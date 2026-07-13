import { Router } from "express";
import { db } from "@workspace/db";
import {
  people, rubricSets, rubricCategories,
  observations, observationScores, schools,
} from "@workspace/db/schema";
import { eq, inArray, and, ne } from "drizzle-orm";
import { TtlCache } from "../lib/ttl-cache";

/* Network-wide (schoolId=null) responses are cached for 2 minutes.
   School-scoped calls are already cheap and bypass the cache entirely. */
const dashboardCache = new TtlCache<object>(2 * 60 * 1000, 5 * 60 * 1000);

const router = Router();

/* ── GET /api/dashboard?rubricSet=Q1&schoolId=2&walkthroughsOnly=true ──
   Returns rubric + observable people with full observation history.
   When walkthroughsOnly=true, only observations where isWalkthrough
   is true are included in the response.                                  */
router.get("/", async (req, res) => {
  try {
    const setSlug          = (req.query.rubricSet as string) || (req.query.quarter as string) || "Q1";
    const schoolIdParam    = req.query.schoolId ? Number(req.query.schoolId) : null;
    const walkthroughsOnly = req.query.walkthroughsOnly === "true";

    const rubricSet = await db.query.rubricSets.findFirst({
      where: eq(rubricSets.slug, setSlug),
    });
    if (!rubricSet) {
      res.status(404).json({ error: `Rubric set '${setSlug}' not found` });
      return;
    }

    /* ── Cache check (network-wide only) ─────────────────────────────
       School-scoped calls are cheap and always fresh; only the "all
       schools" path is expensive enough to warrant caching.           */
    const cacheKey = schoolIdParam === null
      ? `dashboard:${rubricSet.slug}:wt=${walkthroughsOnly}`
      : null;
    if (cacheKey) {
      const hit = dashboardCache.get(cacheKey);
      if (hit) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }
    }

    const categories = await db.query.rubricCategories.findMany({
      where: eq(rubricCategories.rubricSetId, rubricSet.id),
      orderBy: (c, { asc }) => [asc(c.displayOrder)],
      with: {
        domains: {
          orderBy: (d, { asc }) => [asc(d.displayOrder)],
        },
      },
    });

    /* Fetch school gradeSpan when scoped to a specific school */
    let schoolGradeSpan: string | null = null;
    if (schoolIdParam != null) {
      const school = await db.query.schools.findFirst({ where: eq(schools.id, schoolIdParam) });
      schoolGradeSpan = school?.gradeSpan ?? null;
    }

    /* Fetch observable people (includeInFeedbackTracker=true) */
    const allPeople = schoolIdParam != null
      ? await db.select().from(people).where(and(
          eq(people.isActive, true),
          eq(people.includeInFeedbackTracker, true),
          eq(people.schoolId, schoolIdParam),
        ))
      : await db.select().from(people).where(and(
          eq(people.isActive, true),
          eq(people.includeInFeedbackTracker, true),
        ));

    const obsWhere = walkthroughsOnly
      ? and(eq(observations.rubricSetId, rubricSet.id), eq(observations.isWalkthrough, true), ne(observations.status, "draft"))
      : and(eq(observations.rubricSetId, rubricSet.id), ne(observations.status, "draft"));

    const allObs = await db.select().from(observations).where(obsWhere);

    /* ── Fetch editor names for audit trail ───────────────────────── */
    const editorIds = [...new Set(allObs.map((o) => o.editedByEmployeeId).filter((id): id is string => id != null))];
    const editorMap = new Map<string, string>();
    if (editorIds.length > 0) {
      const editors = await db
        .select({ employeeId: people.employeeId, firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .where(inArray(people.employeeId, editorIds));
      for (const e of editors) editorMap.set(e.employeeId, `${e.firstName} ${e.lastName}`.trim());
    }

    const obsIds = allObs.map((o) => o.id);
    const allScores = obsIds.length > 0
      ? await db.select().from(observationScores).where(inArray(observationScores.observationId, obsIds))
      : [];

    const scoresByObs = new Map<number, Record<string, number>>();
    for (const s of allScores) {
      if (!scoresByObs.has(s.observationId)) scoresByObs.set(s.observationId, {});
      scoresByObs.get(s.observationId)![s.domainSlug] = s.score;
    }

    const obsByPerson = new Map<string, typeof allObs>();
    for (const o of allObs) {
      if (!o.observedEmployeeId) continue;
      if (!obsByPerson.has(o.observedEmployeeId)) obsByPerson.set(o.observedEmployeeId, []);
      obsByPerson.get(o.observedEmployeeId)!.push(o);
    }

    const teacherData = allPeople.map((p) => ({
      id:             p.employeeId,
      name:           `${p.firstName} ${p.lastName}`.trim(),
      firstName:      p.firstName,
      lastName:       p.lastName,
      employeeId:     p.employeeId,
      email:          p.email,
      subject:        p.department ?? null,
      gradeLevel:     p.gradeLevel ?? [],
      schoolId:       p.schoolId,
      needsRescore:   p.needsRescore,
      rescoreDueDate: p.rescoreDueDate,
      observations:   (obsByPerson.get(p.employeeId) ?? [])
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((o) => ({
          id:            String(o.id),
          date:          o.date,
          time:          o.time ?? undefined,
          course:        o.course ?? undefined,
          isWalkthrough: o.isWalkthrough,
          strengths:     o.strengths ?? undefined,
          growthAreas:   o.growthAreas ?? undefined,
          observer:      o.observer,
          editedBy:      o.editedByEmployeeId ? (editorMap.get(o.editedByEmployeeId) ?? undefined) : undefined,
          editedAt:      o.editedAt?.toISOString() ?? undefined,
          scores:        scoresByObs.get(o.id) ?? {},
        })),
    }));

    const result = {
      rubricSet:       { id: rubricSet.id, slug: rubricSet.slug, name: rubricSet.name, gradeSpan: rubricSet.gradeSpan, target: rubricSet.target },
      schoolGradeSpan: schoolGradeSpan,
      categories: categories.map((cat) => ({
        id: `cat_${cat.id}`,
        label: cat.name,
        domains: (cat.domains ?? []).map((d) => ({ id: d.slug, label: d.name, description: d.description ?? undefined })),
      })),
      teachers: teacherData,
    };
    if (cacheKey) dashboardCache.set(cacheKey, result);
    res.setHeader("X-Cache", cacheKey ? "MISS" : "BYPASS");
    res.json(result);
  } catch (err) {
    console.error("GET /dashboard error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
