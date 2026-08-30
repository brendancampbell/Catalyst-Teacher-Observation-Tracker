import { Router } from "express";
import { db } from "@workspace/db";
import { people, schools, observations, rubricSets, rubricCategories, observationScores, actionSteps } from "@workspace/db/schema";
import { eq, and, or, sql, inArray, isNotNull, isNull, desc } from "drizzle-orm";
import { getActiveSchoolYearId } from "../lib/active-school-year";
import { getWindows } from "../lib/system-settings";
import { requireAuth, effectiveSchoolId, NoSchoolAssignedError, assertNetworkSchoolAccess } from "../middleware/auth";
import { TtlCache } from "../lib/ttl-cache";
import { loadExtensionSummary } from "./action-steps";

/* Network-averages loads all teachers + observations + scores to compute a
   single aggregate object.  Cache the result per rubricSet+scope for 2 min. */
export const networkAvgsCache = new TtlCache<object>(2 * 60 * 1000, 5 * 60 * 1000);

const router = Router();

/* ── Home Office is not a school ──────────────────────────────────
   Its people are network and admin staff, never observable teachers. GET
   /people has excluded them from the feedback tracker since the beginning;
   the Action Center never did, so pointing it at the Home Office school id
   listed network staff as though they were teachers to observe and rescore.

   Written once and used by all three queries here rather than repeated, since
   repeating it is how /people came to be right and this file wrong.

   isNull is included deliberately: a person with no school at all is not Home
   Office and should not be dropped by this filter. */
const notHomeOffice = or(isNull(schools.isHomeOffice), eq(schools.isHomeOffice, false))!;

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

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." }); return;
    }

    const rubricSet = await db.query.rubricSets.findFirst({
      where: and(eq(rubricSets.slug, setSlug), eq(rubricSets.schoolYearId, activeYearId)),
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
            eq(observations.schoolYearId, activeYearId),
          )
        : and(eq(observations.rubricSetId, rubricSet.id), eq(observations.target, obsTarget), eq(observations.schoolYearId, activeYearId));

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
        .where(and(
          eq(people.isActive, true),
          isNotNull(people.schoolId),
          eq(people.includeInFeedbackTracker, true),
          /* No schools join on this query, so the exclusion is a subquery. */
          sql`EXISTS (SELECT 1 FROM schools s WHERE s.id = ${people.schoolId} AND s.is_home_office = false)`,
        ));

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
      const access = await assertNetworkSchoolAccess(user, requested);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    }
    const scopedSchoolId = effectiveSchoolId(user, requested);

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." }); return;
    }

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
          ? and(eq(people.needsRescore, true), eq(people.schoolId, scopedSchoolId), eq(people.includeInFeedbackTracker, true), eq(people.rescoreSchoolYearId, activeYearId), notHomeOffice)
          : and(eq(people.needsRescore, true), eq(people.includeInFeedbackTracker, true), eq(people.rescoreSchoolYearId, activeYearId), notHomeOffice),
      )
      .orderBy(people.rescoreDueDate);

    res.json(rows.map((r) => ({
      ...r,
      /* people.grade_level is a nullable text[], and every teacher was
         uploaded without one. The published type says string[], so a null
         here is a lie the client cannot defend against — it crashed the
         rescore queue on `.length`. Coalesced at the edge so the type is
         true. */
      gradeLevel:  r.gradeLevel ?? [],
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
    const { overdueWindowDays } = await getWindows();
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" }); return;
    }
    if (requested !== null) {
      const access = await assertNetworkSchoolAccess(user, requested);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    }
    const scopedSchoolId = effectiveSchoolId(user, requested);

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." }); return;
    }

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
        lastObserved: sql<string | null>`MAX(CASE WHEN ${observations.schoolYearId} = ${activeYearId} THEN ${observations.date} END)`,
      })
      .from(people)
      .leftJoin(schools,       eq(people.schoolId, schools.id))
      .leftJoin(observations,  eq(observations.observedEmployeeId, people.employeeId))
      .where(and(
        eq(people.isActive, true),
        eq(people.includeInFeedbackTracker, true),
        schoolFilter,
        notHomeOffice,
      ))
      .groupBy(people.employeeId, people.firstName, people.lastName, people.department, people.gradeLevel, schools.displayName)
      .having(
        /* The overdue window, set in System Settings. Nothing is stored per
           teacher for this list — it is derived here — so changing the window
           takes effect at once and moves no saved deadline. */
        sql`MAX(CASE WHEN ${observations.schoolYearId} = ${activeYearId} THEN ${observations.date} END) < CURRENT_DATE - make_interval(days => ${overdueWindowDays}) OR MAX(CASE WHEN ${observations.schoolYearId} = ${activeYearId} THEN ${observations.date} END) IS NULL`,
      )
      .orderBy(sql`MAX(CASE WHEN ${observations.schoolYearId} = ${activeYearId} THEN ${observations.date} END) ASC NULLS FIRST`);

    res.json(rows.map((r) => ({
      employeeId:   r.employeeId,
      teacherName:  `${r.personFirst} ${r.personLast}`.trim(),
      subject:      r.department,
      gradeLevel:   r.gradeLevel ?? [],
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

/* ── GET /api/action-center/latest-action-steps ──────────────────
   The whole roster, one row per teacher, with their most recent action step.

   Unlike its neighbours this is NOT a queue: a teacher with no action step at
   all is a row here, deliberately blank. That absence is the finding, and it
   is invisible on a list that only shows people who are behind.

   It replaces the Overdue Action Steps sub-tab, which listed one row per
   overdue STEP. Collapsing to one row per teacher would quietly lose a teacher
   whose old step is overdue but who has since been given a newer one, so
   hasOverdueStep is computed across ALL of that teacher's steps, not just the
   one displayed. The overdue filter on the client reads that flag.          */
router.get("/latest-action-steps", requireAuth, async (req, res) => {
  try {
    const user = req.user as Express.User;
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" }); return;
    }
    if (requested !== null) {
      const access = await assertNetworkSchoolAccess(user, requested);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    }
    const scopedSchoolId = effectiveSchoolId(user, requested);

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." }); return;
    }

    const today = new Date().toISOString().split("T")[0]!;

    /* ── The roster ─────────────────────────────────────────────
       Same population as the rest of the Action Center, Home Office
       excluded (see notHomeOffice above).                          */
    const roster = await db
      .select({
        employeeId:  people.employeeId,
        firstName:   people.firstName,
        lastName:    people.lastName,
        department:  people.department,
        gradeLevel:  people.gradeLevel,
        schoolName:  schools.displayName,
      })
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(and(
        eq(people.isActive, true),
        eq(people.includeInFeedbackTracker, true),
        scopedSchoolId !== null ? eq(people.schoolId, scopedSchoolId) : sql`1=1`,
        notHomeOffice,
      ));

    if (roster.length === 0) { res.json([]); return; }
    const teacherIds = roster.map((r) => r.employeeId);

    /* ── Their action steps ─────────────────────────────────────
       Scoped by snapshotSchoolId, the school frozen onto the step when it was
       created — not the teacher's live school. GET /action-steps/latest does
       the same, and for the same reason: a teacher who transferred in must not
       drag their previous school's steps onto this list.

       Draft observations do not create action_steps rows any more (they hold
       the intended step in pendingActionStepText), but drafts written before
       that change did. The observation join excludes those, so nothing a
       coach has not actually published can appear here.                     */
    const stepRows = await db
      .select({
        id:                   actionSteps.id,
        teacherEmployeeId:    actionSteps.teacherEmployeeId,
        text:                 actionSteps.text,
        dueDate:              actionSteps.dueDate,
        status:               actionSteps.status,
        masteredAt:           actionSteps.masteredAt,
        createdAt:            actionSteps.createdAt,
        assignedByEmployeeId: actionSteps.assignedByEmployeeId,
        assignedByFirst:      people.firstName,
        assignedByLast:       people.lastName,
      })
      .from(actionSteps)
      .leftJoin(people, eq(people.employeeId, actionSteps.assignedByEmployeeId))
      .leftJoin(observations, eq(observations.id, actionSteps.assignedDuringObservationId))
      .where(and(
        inArray(actionSteps.teacherEmployeeId, teacherIds),
        eq(actionSteps.schoolYearId, activeYearId),
        scopedSchoolId !== null ? eq(actionSteps.snapshotSchoolId, scopedSchoolId) : sql`1=1`,
        or(isNull(actionSteps.assignedDuringObservationId), sql`${observations.status} <> 'draft'`)!,
      ))
      .orderBy(desc(actionSteps.createdAt), desc(actionSteps.id));

    /* Ordered newest first, so the first step seen for a teacher is theirs. */
    const latestByTeacher = new Map<string, typeof stepRows[number]>();
    const overdueTeachers = new Set<string>();
    for (const r of stepRows) {
      if (!latestByTeacher.has(r.teacherEmployeeId)) latestByTeacher.set(r.teacherEmployeeId, r);
      if (r.status === "open" && r.dueDate < today) overdueTeachers.add(r.teacherEmployeeId);
    }

    /* Extension history only for the steps actually shown. */
    const extensions = await loadExtensionSummary([...latestByTeacher.values()].map((s) => s.id));

    const rows = roster.map((t) => {
      const step = latestByTeacher.get(t.employeeId);
      const ext  = step ? extensions.get(step.id) : undefined;
      const stepOverdue = step ? step.status === "open" && step.dueDate < today : false;
      return {
        employeeId:      t.employeeId,
        teacherName:     `${t.firstName} ${t.lastName}`.trim(),
        department:      t.department,
        gradeLevel:      t.gradeLevel ?? [],
        schoolName:      t.schoolName ?? null,
        /* True when ANY of this teacher's steps is overdue, which is not the
           same as the displayed one being overdue. */
        hasOverdueStep:  overdueTeachers.has(t.employeeId),
        latestStep: step ? {
          id:              step.id,
          text:            step.text,
          assignedDate:    step.createdAt.toISOString().split("T")[0]!,
          dueDate:         step.dueDate,
          status:          step.status,
          mastered:        step.status === "mastered" || step.masteredAt != null,
          masteredAt:      step.masteredAt?.toISOString() ?? null,
          isOverdue:       stepOverdue,
          daysOverdue:     stepOverdue
            ? Math.floor((Date.now() - new Date(step.dueDate).getTime()) / 86_400_000)
            : null,
          extensionCount:  ext?.count ?? 0,
          originalDueDate: ext?.originalDueDate ?? step.dueDate,
          assignerName:    step.assignedByFirst
            ? `${step.assignedByFirst} ${step.assignedByLast ?? ""}`.trim()
            : null,
        } : null,
      };
    });

    /* Overdue first and worst first, so retiring the Overdue Action Steps tab
       does not also retire its triage order. Everyone else alphabetically. */
    rows.sort((a, b) => {
      if (a.hasOverdueStep !== b.hasOverdueStep) return a.hasOverdueStep ? -1 : 1;
      if (a.hasOverdueStep && b.hasOverdueStep) {
        const ad = a.latestStep?.daysOverdue ?? 0;
        const bd = b.latestStep?.daysOverdue ?? 0;
        if (ad !== bd) return bd - ad;
      }
      return a.teacherName.localeCompare(b.teacherName);
    });

    res.json(rows);
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("GET /action-center/latest-action-steps error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
