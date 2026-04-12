import { Router } from "express";
import { db } from "@workspace/db";
import { observations, observationScores, teachers, users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/* ── POST /api/observations ─────────────────────────────────────────
   Body: { teacherId, rubricSetId, date, strengths?, growthAreas?,
           observer?, scores, isWalkthrough? }
   Also accepts legacy field `quarterId` as fallback for rubricSetId.
   observerId is ALWAYS derived from the authenticated session —
   client-supplied observerId is intentionally ignored.               */
router.post("/", async (req, res) => {
  try {
    const {
      teacherId, rubricSetId, quarterId, date, strengths, growthAreas,
      observer, scores, isWalkthrough,
    } = req.body;

    const resolvedRubricSetId = rubricSetId ?? quarterId;

    if (!teacherId || !resolvedRubricSetId || !date || !scores) {
      res.status(400).json({ error: "teacherId, rubricSetId, date and scores are required" });
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
      strengths:     strengths || null,
      growthAreas:   growthAreas || null,
      observer:      observer || creator.name,
      observerId:    creator.id,
      isWalkthrough: !!isWalkthrough,
    }).returning();

    const scoreRows = Object.entries(scores as Record<string, number>).map(([domainSlug, score]) => ({
      observationId: obs.id,
      domainSlug,
      score: Number(score),
    }));

    if (scoreRows.length > 0) {
      await db.insert(observationScores).values(scoreRows);
    }

    /* ── Walkthrough / Rescore queue logic ───────────────────────────
       Applies when isWalkthrough === true. Uses creator.role from the
       authenticated session — never from client-supplied body data.   */
    if (obs.isWalkthrough) {
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
      id:           String(obs.id),
      date:         obs.date,
      isWalkthrough: obs.isWalkthrough,
      strengths:    obs.strengths ?? undefined,
      growthAreas:  obs.growthAreas ?? undefined,
      observer:     obs.observer,
      scores:       Object.fromEntries(savedScores.map((s) => [s.domainSlug, s.score])),
    });
  } catch (err) {
    console.error("POST /observations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/observations/:id ──────────────────────────────────────
   Permitted roles: SCHOOL_LEADER, NETWORK_LEADER, NETWORK_ADMIN
   COACHes may NOT edit observations.
   Stores editedById + editedAt for the audit trail.                  */
router.put("/:id", async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const obsId = Number(req.params.id);
    const { strengths, growthAreas, observer, scores } = req.body;

    /* ── Role gate ──────────────────────────────────────────────── */
    const isSchoolLeader   = currentUser.role === "SCHOOL_LEADER";
    const isNetworkLeader  = currentUser.role === "NETWORK_LEADER";
    const isNetworkAdmin   = currentUser.role === "NETWORK_ADMIN";

    if (!isSchoolLeader && !isNetworkLeader && !isNetworkAdmin) {
      res.status(403).json({ error: "Only School Leaders, Network Leaders, and Network Admins may edit observations" });
      return;
    }

    const existing = await db.query.observations.findFirst({
      where: eq(observations.id, obsId),
    });
    if (!existing) { res.status(404).json({ error: "Observation not found" }); return; }

    /* ── School-scope for School Leaders ────────────────────────── */
    if (isSchoolLeader) {
      const teacher = await db.query.teachers.findFirst({ where: eq(teachers.id, existing.teacherId) });
      if (!teacher || teacher.schoolId !== currentUser.schoolId) {
        res.status(403).json({ error: "Cannot edit observations for teachers outside your school" });
        return;
      }
    }

    const [updated] = await db.update(observations)
      .set({
        strengths:   strengths  ?? existing.strengths,
        growthAreas: growthAreas ?? existing.growthAreas,
        observer:    observer   ?? existing.observer,
        editedById:  currentUser.id,
        editedAt:    new Date(),
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
      isWalkthrough: updated.isWalkthrough,
      strengths:     updated.strengths  ?? undefined,
      growthAreas:   updated.growthAreas ?? undefined,
      observer:      updated.observer,
      editedBy:      editedByName,
      editedAt:      updated.editedAt?.toISOString() ?? undefined,
      scores:        Object.fromEntries(savedScores.map((s) => [s.domainSlug, s.score])),
    });
  } catch (err) {
    console.error("PUT /observations/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
