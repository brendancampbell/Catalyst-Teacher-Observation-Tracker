import { Router } from "express";
import { db } from "@workspace/db";
import { observations, observationScores, teachers, users, rubricSets } from "@workspace/db/schema";
import { eq, desc, and, ne, inArray } from "drizzle-orm";

const router = Router();

/* ── GET /api/observations/my-latest-rubric ─────────────────────────
   Returns the slug of the rubric set containing the current user's
   most recent PUBLISHED observation (by date). Returns { slug: null }
   if the user has no published observations recorded.                 */
router.get("/my-latest-rubric", async (req, res) => {
  const currentUser = req.user as Express.User;
  const latest = await db
    .select({ slug: rubricSets.slug })
    .from(observations)
    .innerJoin(rubricSets, eq(rubricSets.id, observations.rubricSetId))
    .where(and(eq(observations.observerId, currentUser.id), ne(observations.status, "draft")))
    .orderBy(desc(observations.date))
    .limit(1);

  res.json({ slug: latest[0]?.slug ?? null });
});

/* ── GET /api/observations/drafts ───────────────────────────────────
   Returns all draft observations created by the current user,
   with their scores included.                                         */
router.get("/drafts", async (req, res) => {
  try {
    const currentUser = req.user as Express.User;

    const drafts = await db
      .select({
        id:            observations.id,
        teacherId:     observations.teacherId,
        teacherName:   teachers.name,
        rubricSetId:   observations.rubricSetId,
        rubricSetSlug: rubricSets.slug,
        rubricSetName: rubricSets.name,
        date:          observations.date,
        time:          observations.time,
        course:        observations.course,
        isWalkthrough: observations.isWalkthrough,
        strengths:     observations.strengths,
        growthAreas:   observations.growthAreas,
        observer:      observations.observer,
        status:        observations.status,
      })
      .from(observations)
      .innerJoin(teachers,   eq(teachers.id,   observations.teacherId))
      .innerJoin(rubricSets, eq(rubricSets.id,  observations.rubricSetId))
      .where(and(eq(observations.observerId, currentUser.id), eq(observations.status, "draft")))
      .orderBy(desc(observations.date));

    if (drafts.length === 0) {
      res.json([]);
      return;
    }

    const draftIds = drafts.map((d) => d.id);
    const allScores = await db
      .select()
      .from(observationScores)
      .where(inArray(observationScores.observationId, draftIds));

    const scoresByObs = new Map<number, Record<string, number>>();
    for (const s of allScores) {
      if (!scoresByObs.has(s.observationId)) scoresByObs.set(s.observationId, {});
      scoresByObs.get(s.observationId)![s.domainSlug] = s.score;
    }

    res.json(drafts.map((d) => ({
      id:            String(d.id),
      teacherId:     String(d.teacherId),
      teacherName:   d.teacherName,
      rubricSetId:   d.rubricSetId,
      rubricSetSlug: d.rubricSetSlug,
      rubricSetName: d.rubricSetName,
      date:          d.date,
      time:          d.time ?? undefined,
      course:        d.course ?? undefined,
      isWalkthrough: d.isWalkthrough,
      strengths:     d.strengths ?? undefined,
      growthAreas:   d.growthAreas ?? undefined,
      observer:      d.observer,
      status:        d.status,
      scores:        scoresByObs.get(d.id) ?? {},
    })));
  } catch (err) {
    console.error("GET /observations/drafts error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/observations ─────────────────────────────────────────
   Body: { teacherId, rubricSetId, date, strengths?, growthAreas?,
           observer?, scores, isWalkthrough?, status? }
   Also accepts legacy field `quarterId` as fallback for rubricSetId.
   observerId is ALWAYS derived from the authenticated session —
   client-supplied observerId is intentionally ignored.
   status defaults to "published". Drafts skip the rescore queue.     */
router.post("/", async (req, res) => {
  try {
    const {
      teacherId, rubricSetId, quarterId, date, time, course, strengths, growthAreas,
      observer, scores, isWalkthrough, status,
    } = req.body;

    const resolvedRubricSetId = rubricSetId ?? quarterId;
    const resolvedStatus: string = status === "draft" ? "draft" : "published";

    if (!teacherId || !resolvedRubricSetId || !date) {
      res.status(400).json({ error: "teacherId, rubricSetId, and date are required" });
      return;
    }
    if (resolvedStatus === "published" && !scores) {
      res.status(400).json({ error: "scores are required for published observations" });
      return;
    }

    /* ── Identity: always use the authenticated session user ─────── */
    const creator = req.user as Express.User;

    /* ── School-scope enforcement on create ─────────────────────────
       COACH and SCHOOL_LEADER may only observe teachers at their
       own school. NETWORK_LEADER / NETWORK_ADMIN have no restriction. */
    const isSchoolScoped = creator.role === "COACH" || creator.role === "SCHOOL_LEADER";
    if (isSchoolScoped) {
      const target = await db.query.teachers.findFirst({ where: eq(teachers.id, Number(teacherId)) });
      if (!target || target.schoolId !== creator.schoolId) {
        res.status(403).json({ error: "Cannot create an observation for a teacher outside your school" });
        return;
      }
    }

    const [obs] = await db.insert(observations).values({
      teacherId:     Number(teacherId),
      rubricSetId:   Number(resolvedRubricSetId),
      date,
      time:          time || null,
      course:        course || null,
      strengths:     strengths || null,
      growthAreas:   growthAreas || null,
      observer:      observer || creator.name,
      observerId:    creator.id,
      isWalkthrough: !!isWalkthrough,
      status:        resolvedStatus,
    }).returning();

    const scoreRows = scores
      ? Object.entries(scores as Record<string, number>).map(([domainSlug, score]) => ({
          observationId: obs.id,
          domainSlug,
          score: Number(score),
        }))
      : [];

    if (scoreRows.length > 0) {
      await db.insert(observationScores).values(scoreRows);
    }

    /* ── Walkthrough / Rescore queue logic ───────────────────────────
       Only runs for PUBLISHED observations.
       Applies when isWalkthrough === true.                            */
    if (obs.isWalkthrough && obs.status === "published") {
      const canTriggerRescore =
        creator.role === "NETWORK_ADMIN" ||
        creator.role === "NETWORK_LEADER" ||
        creator.role === "SCHOOL_LEADER";

      if (canTriggerRescore && scoreRows.length > 0) {
        const avg = scoreRows.reduce((s, r) => s + r.score, 0) / scoreRows.length;

        if (avg < 0.7) {
          const due = new Date(date);
          due.setDate(due.getDate() + 14);
          const dueDateStr = due.toISOString().split("T")[0];
          await db.update(teachers)
            .set({ needsRescore: true, rescoreDueDate: dueDateStr })
            .where(eq(teachers.id, Number(teacherId)));
        } else {
          await db.update(teachers)
            .set({ needsRescore: false, rescoreDueDate: null })
            .where(eq(teachers.id, Number(teacherId)));
        }
      }
    }

    const savedScores = await db.select().from(observationScores)
      .where(eq(observationScores.observationId, obs.id));

    res.status(201).json({
      id:            String(obs.id),
      date:          obs.date,
      time:          obs.time ?? undefined,
      course:        obs.course ?? undefined,
      isWalkthrough: obs.isWalkthrough,
      strengths:     obs.strengths ?? undefined,
      growthAreas:   obs.growthAreas ?? undefined,
      observer:      obs.observer,
      status:        obs.status,
      scores:        Object.fromEntries(savedScores.map((s) => [s.domainSlug, s.score])),
    });
  } catch (err) {
    console.error("POST /observations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/observations/:id ──────────────────────────────────────
   For PUBLISHED observations: requires SCHOOL_LEADER, NETWORK_LEADER,
   or NETWORK_ADMIN.
   For DRAFT observations: the original creator (any role) may edit or
   publish their own draft.
   Stores editedById + editedAt for the audit trail on published edits. */
router.put("/:id", async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const obsId = Number(req.params.id);
    const { strengths, growthAreas, observer, scores, status } = req.body;

    const existing = await db.query.observations.findFirst({
      where: eq(observations.id, obsId),
    });
    if (!existing) { res.status(404).json({ error: "Observation not found" }); return; }

    const isDraftEdit = existing.status === "draft" && existing.observerId === currentUser.id;

    /* ── Role gate ──────────────────────────────────────────────────
       Draft creators (any role) may edit/publish their own drafts.
       Published observations require SCHOOL_LEADER+.               */
    if (!isDraftEdit) {
      const isSchoolLeader   = currentUser.role === "SCHOOL_LEADER";
      const isNetworkLeader  = currentUser.role === "NETWORK_LEADER";
      const isNetworkAdmin   = currentUser.role === "NETWORK_ADMIN";

      if (!isSchoolLeader && !isNetworkLeader && !isNetworkAdmin) {
        res.status(403).json({ error: "Only School Leaders, Network Leaders, and Network Admins may edit observations" });
        return;
      }

      /* ── School-scope for School Leaders ───────────────────────── */
      if (currentUser.role === "SCHOOL_LEADER") {
        const teacher = await db.query.teachers.findFirst({ where: eq(teachers.id, existing.teacherId) });
        if (!teacher || teacher.schoolId !== currentUser.schoolId) {
          res.status(403).json({ error: "Cannot edit observations for teachers outside your school" });
          return;
        }
      }
    }

    const resolvedStatus = status === "draft" ? "draft" : status === "published" ? "published" : existing.status;
    const isPublishing = existing.status === "draft" && resolvedStatus === "published";

    /* Stamp editedBy only for edits to already-published observations */
    const auditFields = !isDraftEdit
      ? { editedById: currentUser.id, editedAt: new Date() }
      : {};

    const [updated] = await db.update(observations)
      .set({
        strengths:   strengths   !== undefined ? (strengths   || null) : existing.strengths,
        growthAreas: growthAreas !== undefined ? (growthAreas || null) : existing.growthAreas,
        observer:    observer    !== undefined ? (observer    || existing.observer) : existing.observer,
        status:      resolvedStatus,
        ...auditFields,
      })
      .where(eq(observations.id, obsId))
      .returning();

    if (scores && typeof scores === "object") {
      await db.delete(observationScores).where(eq(observationScores.observationId, obsId));
      const scoreRows = Object.entries(scores as Record<string, number>).map(([domainSlug, score]) => ({
        observationId: obsId,
        domainSlug,
        score: Number(score),
      }));
      if (scoreRows.length > 0) await db.insert(observationScores).values(scoreRows);
    }

    /* ── Walkthrough / Rescore queue logic on publish ─────────────── */
    if (isPublishing && updated.isWalkthrough) {
      const canTriggerRescore =
        currentUser.role === "NETWORK_ADMIN" ||
        currentUser.role === "NETWORK_LEADER" ||
        currentUser.role === "SCHOOL_LEADER";

      if (canTriggerRescore) {
        const savedScoresForRescore = await db.select().from(observationScores)
          .where(eq(observationScores.observationId, obsId));
        if (savedScoresForRescore.length > 0) {
          const avg = savedScoresForRescore.reduce((s, r) => s + r.score, 0) / savedScoresForRescore.length;
          if (avg < 0.7) {
            const due = new Date(updated.date);
            due.setDate(due.getDate() + 14);
            await db.update(teachers)
              .set({ needsRescore: true, rescoreDueDate: due.toISOString().split("T")[0] })
              .where(eq(teachers.id, updated.teacherId));
          } else {
            await db.update(teachers)
              .set({ needsRescore: false, rescoreDueDate: null })
              .where(eq(teachers.id, updated.teacherId));
          }
        }
      }
    }

    const savedScores = await db.select().from(observationScores)
      .where(eq(observationScores.observationId, obsId));

    /* ── Look up editor's name for the response ─────────────────── */
    let editedByName: string | undefined;
    if (updated.editedById) {
      const editor = await db.query.users.findFirst({ where: eq(users.id, updated.editedById) });
      editedByName = editor?.name ?? undefined;
    }

    res.json({
      id:            String(updated.id),
      date:          updated.date,
      time:          updated.time ?? undefined,
      course:        updated.course ?? undefined,
      isWalkthrough: updated.isWalkthrough,
      strengths:     updated.strengths  ?? undefined,
      growthAreas:   updated.growthAreas ?? undefined,
      observer:      updated.observer,
      status:        updated.status,
      editedBy:      editedByName,
      editedAt:      updated.editedAt?.toISOString() ?? undefined,
      scores:        Object.fromEntries(savedScores.map((s) => [s.domainSlug, s.score])),
    });
  } catch (err) {
    console.error("PUT /observations/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── DELETE /api/observations/:id ───────────────────────────────────
   Permitted roles: SCHOOL_LEADER, NETWORK_LEADER, NETWORK_ADMIN
   Draft creators (any role) may delete their own drafts.
   School Leaders are restricted to teachers in their own school.
   observation_scores are removed automatically by the FK ON DELETE
   CASCADE defined in the schema.                                     */
router.delete("/:id", async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const obsId = Number(req.params.id);

    if (!Number.isFinite(obsId)) {
      res.status(400).json({ error: "Invalid observation id" });
      return;
    }

    const existing = await db.query.observations.findFirst({
      where: eq(observations.id, obsId),
    });
    if (!existing) { res.status(404).json({ error: "Observation not found" }); return; }

    const isDraftOwner = existing.status === "draft" && existing.observerId === currentUser.id;

    if (!isDraftOwner) {
      const isSchoolLeader  = currentUser.role === "SCHOOL_LEADER";
      const isNetworkLeader = currentUser.role === "NETWORK_LEADER";
      const isNetworkAdmin  = currentUser.role === "NETWORK_ADMIN";

      if (!isSchoolLeader && !isNetworkLeader && !isNetworkAdmin) {
        res.status(403).json({ error: "Only School Leaders, Network Leaders, and Network Admins may delete observations" });
        return;
      }

      if (currentUser.role === "SCHOOL_LEADER") {
        const teacher = await db.query.teachers.findFirst({ where: eq(teachers.id, existing.teacherId) });
        if (!teacher || teacher.schoolId !== currentUser.schoolId) {
          res.status(403).json({ error: "Cannot delete observations for teachers outside your school" });
          return;
        }
      }
    }

    await db.delete(observations).where(eq(observations.id, obsId));

    res.json({ ok: true, id: String(obsId) });
  } catch (err) {
    console.error("DELETE /observations/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
