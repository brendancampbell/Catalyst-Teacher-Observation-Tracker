import { Router } from "express";
import { db } from "@workspace/db";
import {
  people, rubricSets,
  observations, observationScores,
} from "@workspace/db/schema";
import { eq, and, inArray, ne } from "drizzle-orm";

const router = Router();

/* ── GET /api/teachers/:id?quarter=Q1 ───────────────────────────────
   :id is now an employeeId (text). Still accepts ?quarter= rubric slug. */
router.get("/:id", async (req, res) => {
  try {
    const employeeId  = req.params.id;
    const quarterSlug = (req.query.quarter as string) || "Q1";

    const person = await db.query.people.findFirst({
      where: eq(people.employeeId, employeeId),
    });
    if (!person) { res.status(404).json({ error: "Person not found" }); return; }

    /* School-scope check */
    const currentUser = req.user as Express.User;
    const isNetworkScope = currentUser.role === "NETWORK_ADMIN" || currentUser.role === "NETWORK_LEADER";
    if (!isNetworkScope && person.schoolId !== currentUser.schoolId) {
      res.status(403).json({ error: "Cannot access people from another school" });
      return;
    }

    const quarter = await db.query.rubricSets.findFirst({
      where: eq(rubricSets.slug, quarterSlug),
    });
    if (!quarter) { res.status(404).json({ error: "Rubric set not found" }); return; }

    const obsRows = await db.select().from(observations)
      .where(and(
        eq(observations.observedEmployeeId, employeeId),
        eq(observations.rubricSetId, quarter.id),
        ne(observations.status, "draft"),
      ));

    const obsIds = obsRows.map((o) => o.id);
    const scores = obsIds.length > 0
      ? await db.select().from(observationScores).where(inArray(observationScores.observationId, obsIds))
      : [];

    const scoresByObs = new Map<number, Record<string, number>>();
    for (const s of scores) {
      if (!scoresByObs.has(s.observationId)) scoresByObs.set(s.observationId, {});
      scoresByObs.get(s.observationId)![s.domainSlug] = s.score;
    }

    res.json({
      id:         person.employeeId,
      name:       `${person.firstName} ${person.lastName}`.trim(),
      firstName:  person.firstName,
      lastName:   person.lastName,
      employeeId: person.employeeId,
      email:      person.email,
      subject:    person.department,
      gradeLevel: person.gradeLevel,
      observations: obsRows
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((o) => ({
          id:                 String(o.id),
          date:               o.date,
          strengths:          o.strengths ?? undefined,
          growthAreas:        o.growthAreas ?? undefined,
          observer:           o.observer,
          observerEmployeeId: o.observerEmployeeId ?? undefined,
          observerEmail:      o.observerEmail ?? undefined,
          scores:             scoresByObs.get(o.id) ?? {},
        })),
    });
  } catch (err) {
    console.error("GET /teachers/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
