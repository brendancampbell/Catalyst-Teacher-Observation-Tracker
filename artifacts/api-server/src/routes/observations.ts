import { Router } from "express";
import { db } from "@workspace/db";
import { observations, observationScores, teachers, users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/* ── POST /api/observations ─────────────────────────────────────────
   Body: { teacherId, rubricSetId, date, strengths?, growthAreas?,
           observer?, observerId?, scores, isWalkthrough? }
   Also accepts legacy field `quarterId` as fallback.                 */
router.post("/", async (req, res) => {
  try {
    const {
      teacherId, rubricSetId, quarterId, date, strengths, growthAreas,
      observer, observerId, scores, isWalkthrough,
    } = req.body;

    const resolvedRubricSetId = rubricSetId ?? quarterId;

    if (!teacherId || !resolvedRubricSetId || !date || !scores) {
      res.status(400).json({ error: "teacherId, rubricSetId, date and scores are required" });
      return;
    }

    const [obs] = await db.insert(observations).values({
      teacherId:     Number(teacherId),
      rubricSetId:   Number(resolvedRubricSetId),
      date,
      strengths:     strengths || null,
      growthAreas:   growthAreas || null,
      observer:      observer || "Principal Rivera",
      observerId:    observerId ? Number(observerId) : null,
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

    /* ── Walkthrough rescore logic ────────────────────────────────
       Only applies when isWalkthrough === true AND the submitter
       is a DISTRICT_ADMIN (looked up via observerId).              */
    if (obs.isWalkthrough && obs.observerId) {
      const submitter = await db.query.users.findFirst({
        where: eq(users.id, obs.observerId),
      });

      if (submitter?.role === "DISTRICT_ADMIN" && scoreRows.length > 0) {
        const avg = scoreRows.reduce((s, r) => s + r.score, 0) / scoreRows.length;

        if (avg < 3.0) {
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
   Body: { date?, strengths?, growthAreas?, observer?, scores? }      */
router.put("/:id", async (req, res) => {
  try {
    const obsId = Number(req.params.id);
    const { date, strengths, growthAreas, observer, scores } = req.body;

    const existing = await db.query.observations.findFirst({
      where: eq(observations.id, obsId),
    });
    if (!existing) { res.status(404).json({ error: "Observation not found" }); return; }

    const [updated] = await db.update(observations)
      .set({
        ...(date && { date }),
        strengths:  strengths ?? existing.strengths,
        growthAreas: growthAreas ?? existing.growthAreas,
        observer:   observer ?? existing.observer,
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

    res.json({
      id:           String(updated.id),
      date:         updated.date,
      isWalkthrough: updated.isWalkthrough,
      strengths:    updated.strengths ?? undefined,
      growthAreas:  updated.growthAreas ?? undefined,
      observer:     updated.observer,
      scores:       Object.fromEntries(savedScores.map((s) => [s.domainSlug, s.score])),
    });
  } catch (err) {
    console.error("PUT /observations/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
