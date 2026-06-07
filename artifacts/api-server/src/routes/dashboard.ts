import { Router } from "express";
import { db } from "@workspace/db";
import {
  teachers, rubricSets, rubricCategories,
  observations, observationScores, users, schools,
} from "@workspace/db/schema";
import { eq, inArray, and, ne } from "drizzle-orm";

const router = Router();

/* ── GET /api/dashboard?rubricSet=Q1&schoolId=2&walkthroughsOnly=true ──
   Accepts legacy param `quarter` as fallback for backward compat.
   Returns rubric + teachers with full observation history.
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

    const allTeachers = schoolIdParam != null
      ? await db.select().from(teachers).where(and(eq(teachers.isActive, true), eq(teachers.schoolId, schoolIdParam)))
      : await db.select().from(teachers).where(eq(teachers.isActive, true));

    const obsWhere = walkthroughsOnly
      ? and(eq(observations.rubricSetId, rubricSet.id), eq(observations.isWalkthrough, true), ne(observations.status, "draft"))
      : and(eq(observations.rubricSetId, rubricSet.id), ne(observations.status, "draft"));

    const allObs = await db.select().from(observations).where(obsWhere);

    /* ── Fetch editor names for audit trail ───────────────────────── */
    const editorIds = [...new Set(allObs.map((o) => o.editedById).filter((id): id is number => id != null))];
    const editorMap = new Map<number, string>();
    if (editorIds.length > 0) {
      const editors = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, editorIds));
      for (const e of editors) editorMap.set(e.id, e.name);
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

    const obsByTeacher = new Map<number, typeof allObs>();
    for (const o of allObs) {
      if (!obsByTeacher.has(o.teacherId)) obsByTeacher.set(o.teacherId, []);
      obsByTeacher.get(o.teacherId)!.push(o);
    }

    const teacherData = allTeachers.map((t) => ({
      id:             String(t.id),
      name:           `${t.firstName} ${t.lastName}`.trim(),
      firstName:      t.firstName,
      lastName:       t.lastName,
      employeeId:     t.employeeId,
      email:          t.email,
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
          time:          o.time ?? undefined,
          course:        o.course ?? undefined,
          isWalkthrough: o.isWalkthrough,
          strengths:     o.strengths ?? undefined,
          growthAreas:   o.growthAreas ?? undefined,
          observer:      o.observer,
          editedBy:      o.editedById ? (editorMap.get(o.editedById) ?? undefined) : undefined,
          editedAt:      o.editedAt?.toISOString() ?? undefined,
          scores:        scoresByObs.get(o.id) ?? {},
        })),
    }));

    res.json({
      rubricSet:       { id: rubricSet.id, slug: rubricSet.slug, name: rubricSet.name, gradeSpan: rubricSet.gradeSpan, target: rubricSet.target },
      schoolGradeSpan: schoolGradeSpan,
      categories: categories.map((cat) => ({
        id: `cat_${cat.id}`,
        label: cat.name,
        domains: (cat.domains ?? []).map((d) => ({ id: d.slug, label: d.name, description: d.description ?? undefined })),
      })),
      teachers: teacherData,
    });
  } catch (err) {
    console.error("GET /dashboard error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
