import { Router } from "express";
import { db } from "@workspace/db";
import { people, schools, observations, rubricSets, rubricCategories, observationScores } from "@workspace/db/schema";
import { eq, and, max, sql, inArray, isNotNull } from "drizzle-orm";
import { requireAuth, effectiveSchoolId, NoSchoolAssignedError } from "../middleware/auth";
import { TtlCache } from "../lib/ttl-cache";

/* Network-averages loads all teachers + observations + scores to compute a
   single aggregate object.  Cache the result per rubricSet+scope for 2 min. */
export const networkAvgsCache = new TtlCache<object>(2 * 60 * 1000, 5 * 60 * 1000);

const router = Router();

type SchoolCheckResult = "ok" | "not_found" | "inactive";

async function checkSchool(id: number): Promise<SchoolCheckResult> {
  const rows = await db
    .select({ id: schools.id, isActive: schools.isActive, isArchived: schools.isArchived })
    .from(schools)
    .where(eq(schools.id, id))
    .limit(1);
  if (rows.length === 0) return "not_found";
  const s = rows[0]!;
  if (!s.isActive || s.isArchived) return "inactive";
  return "ok";
}

/* ── GET /api/action-center/network-averages ─────────────────────
   Domain averages for authenticated users.
   - TEACHER-target rubrics: network-wide aggregate (no per-school
     breakdown) used for the network comparison table.
   - SCHOOL-target rubrics: filtered to the requester's own school
     for SCHOOL_LEADER / COACH; network-wide for NETWORK_* roles.
   Returns only the aggregate — no per-school names or rows.       */
router.get("/network-averages", requireAuth, async (req, res) => {
  try {
    const user = req.user as Express.User;
    const scopedSchoolId = effectiveSchoolId(user, null);

    const setSlug = (req.query.rubricSet as string) || "Q1";

    const rubricSet = await db.query.rubricSets.findFirst({
      where: eq(rubricSets.slug, setSlug),
    });
    if (!rubricSet) {
      res.status(404).json({ error: `Rubric set '${setSlug}' not found` }); return;
    }

    /* ── Cache check ──────────────────────────────────────────────────
       Network-averages loads all teachers + all observations + all
       scores per request.  Cache the compact aggregate for 2 minutes.  */
    const cacheKey = `network-avgs:${rubricSet.slug}:scope=${scopedSchoolId ?? "all"}`;
    {
      const hit = networkAvgsCache.get(cacheKey);
      if (hit) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }
    }

    const categories = await db.query.rubricCategories.findMany({
      where: eq(rubricCategories.rubricSetId, rubricSet.id),
      orderBy: (c, { asc }) => [asc(c.displayOrder)],
      with: { domains: { orderBy: (d, { asc }) => [asc(d.displayOrder)] } },
    });

    const allDomains = categories.flatMap((c) => c.domains ?? []);
    const allSlugs   = allDomains.map((d) => d.slug);

    if (allSlugs.length === 0) {
      res.json({ domainAverages: {} }); return;
    }

    const obsTarget = rubricSet.target === "SCHOOL" ? "SCHOOL" : "TEACHER";

    /* For SCHOOL-target rubrics, school-scoped roles (SCHOOL_LEADER, COACH)
       must only see observations from their own school.                       */
    const obsWhereClause =
      rubricSet.target === "SCHOOL" && scopedSchoolId !== null
        ? and(
            eq(observations.rubricSetId, rubricSet.id),
            eq(observations.target, "SCHOOL"),
            eq(observations.schoolId, scopedSchoolId),
          )
        : and(eq(observations.rubricSetId, rubricSet.id), eq(observations.target, obsTarget));

    const allObs = await db
      .select()
      .from(observations)
      .where(obsWhereClause);

    const obsIds    = allObs.map((o) => o.id);
    const allScores = obsIds.length > 0
      ? await db.select().from(observationScores).where(inArray(observationScores.observationId, obsIds))
      : [];

    const scoresByObs = new Map<number, Record<string, number>>();
    for (const s of allScores) {
      if (!scoresByObs.has(s.observationId)) scoresByObs.set(s.observationId, {});
      scoresByObs.get(s.observationId)![s.domainSlug] = s.score;
    }

    const domainSums:   Record<string, number> = {};
    const domainCounts: Record<string, number> = {};

    if (rubricSet.target === "TEACHER") {
      /* Most-recent observation per teacher per domain (same as district summary) */
      const allPeople = await db
        .select()
        .from(people)
        .where(and(eq(people.isActive, true), isNotNull(people.schoolId), eq(people.includeInFeedbackTracker, true)));

      const obsByTeacher = new Map<string, typeof allObs>();
      for (const o of allObs) {
        if (!o.observedEmployeeId) continue;
        if (!obsByTeacher.has(o.observedEmployeeId)) obsByTeacher.set(o.observedEmployeeId, []);
        obsByTeacher.get(o.observedEmployeeId)!.push(o);
      }
      for (const [, obs] of obsByTeacher) obs.sort((a, b) => b.date.localeCompare(a.date));

      for (const t of allPeople) {
        const obs = obsByTeacher.get(t.employeeId) ?? [];
        if (obs.length === 0) continue;
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
      }
    } else {
      /* SCHOOL target: average across all school observations */
      for (const o of allObs) {
        const scores = scoresByObs.get(o.id) ?? {};
        for (const slug of allSlugs) {
          const v = scores[slug];
          if (v != null) {
            domainSums[slug]   = (domainSums[slug]   ?? 0) + v;
            domainCounts[slug] = (domainCounts[slug] ?? 0) + 1;
          }
        }
      }
    }

    const domainAverages: Record<string, number | null> = {};
    for (const slug of allSlugs) {
      const cnt = domainCounts[slug] ?? 0;
      domainAverages[slug] = cnt > 0 ? Math.round((domainSums[slug] / cnt) * 100) / 100 : null;
    }

    const result = { domainAverages };
    networkAvgsCache.set(cacheKey, result);
    res.setHeader("X-Cache", "MISS");
    res.json(result);
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("GET /action-center/network-averages error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/action-center/rescore-queue ───────────────────────── */
router.get("/rescore-queue", requireAuth, async (req, res) => {
  try {
    const user = req.user as Express.User;
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" }); return;
    }
    if (requested !== null) {
      const check = await checkSchool(requested);
      if (check === "not_found") { res.status(404).json({ error: "School not found" }); return; }
      if (check === "inactive")  { res.status(422).json({ error: "School is inactive" }); return; }
    }
    const scopedSchoolId = effectiveSchoolId(user, requested);

    const rows = await db
      .select({
        employeeId:     people.employeeId,
        personFirst:    people.firstName,
        personLast:     people.lastName,
        department:     people.department,
        gradeLevel:     people.gradeLevel,
        schoolName:     schools.displayName,
        rescoreDueDate: people.rescoreDueDate,
        needsRescore:   people.needsRescore,
      })
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(
        scopedSchoolId !== null
          ? and(eq(people.needsRescore, true), eq(people.schoolId, scopedSchoolId), eq(people.includeInFeedbackTracker, true))
          : and(eq(people.needsRescore, true), eq(people.includeInFeedbackTracker, true)),
      )
      .orderBy(people.rescoreDueDate);

    res.json(rows.map((r) => ({
      ...r,
      teacherName: `${r.personFirst} ${r.personLast}`.trim(),
    })));
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("GET /action-center/rescore-queue error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/action-center/overdue-observations ────────────────── */
router.get("/overdue-observations", requireAuth, async (req, res) => {
  try {
    const user = req.user as Express.User;
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" }); return;
    }
    if (requested !== null) {
      const check = await checkSchool(requested);
      if (check === "not_found") { res.status(404).json({ error: "School not found" }); return; }
      if (check === "inactive")  { res.status(422).json({ error: "School is inactive" }); return; }
    }
    const scopedSchoolId = effectiveSchoolId(user, requested);

    const schoolFilter = scopedSchoolId !== null
      ? sql`${people.schoolId} = ${scopedSchoolId}`
      : sql`1=1`;

    const rows = await db
      .select({
        employeeId:   people.employeeId,
        personFirst:  people.firstName,
        personLast:   people.lastName,
        department:   people.department,
        gradeLevel:   people.gradeLevel,
        schoolName:   schools.displayName,
        lastObserved: max(observations.date),
      })
      .from(people)
      .leftJoin(schools,       eq(people.schoolId, schools.id))
      .leftJoin(observations,  eq(observations.observedEmployeeId, people.employeeId))
      .where(and(
        eq(people.isActive, true),
        eq(people.includeInFeedbackTracker, true),
        schoolFilter,
      ))
      .groupBy(people.employeeId, people.firstName, people.lastName, people.department, people.gradeLevel, schools.displayName)
      .having(
        sql`MAX(${observations.date}) < CURRENT_DATE - INTERVAL '14 days' OR MAX(${observations.date}) IS NULL`,
      )
      .orderBy(sql`MAX(${observations.date}) ASC NULLS FIRST`);

    res.json(rows.map((r) => ({
      employeeId:   r.employeeId,
      teacherName:  `${r.personFirst} ${r.personLast}`.trim(),
      subject:      r.department,
      gradeLevel:   r.gradeLevel,
      schoolName:   r.schoolName,
      lastObserved: r.lastObserved ?? null,
      daysSince:    r.lastObserved
        ? Math.floor((Date.now() - new Date(r.lastObserved).getTime()) / 86_400_000)
        : null,
    })));
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("GET /action-center/overdue-observations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
