import { Router } from "express";
import { db } from "@workspace/db";
import {
  people, rubricSets,
  observations, observationScores,
} from "@workspace/db/schema";
import { eq, and, inArray, ne } from "drizzle-orm";
import { getActiveSchoolYearId } from "../lib/active-school-year";
import {
  canAccessSchoolScopedRecord,
  effectiveSchoolId,
  NoSchoolAssignedError,
} from "../middleware/auth";

/* Build a map of employeeId → { name, email } for observer lookups. */
async function fetchObserverInfo(
  ids: string[],
): Promise<Map<string, { name: string; email: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ employeeId: people.employeeId, firstName: people.firstName, lastName: people.lastName, email: people.email })
    .from(people)
    .where(inArray(people.employeeId, ids));
  const map = new Map<string, { name: string; email: string }>();
  for (const r of rows) map.set(r.employeeId, { name: `${r.firstName} ${r.lastName}`.trim(), email: r.email });
  return map;
}

const router = Router();

/* ── GET /api/teachers/:id?quarter=Q1 ───────────────────────────────
   :id is now an employeeId (text). Still accepts ?quarter= rubric slug. */
router.get("/:id", async (req, res) => {
  try {
    const employeeId  = req.params.id;
    const quarterSlug = (req.query.quarter as string) || "Q1";

    const currentUser = req.user as Express.User;

    /* Resolve the caller's scope BEFORE any lookup.

       effectiveSchoolId returns the caller's own schoolId for COACH and
       SCHOOL_LEADER, and null — meaning all schools — only for network
       roles. For a school-scoped caller with no school assigned it throws
       instead of returning null, which is the case this route used to get
       wrong: this router is mounted with requireAuth alone, so unlike the
       dashboard it has no enforceSchoolScope in front of it to reject that
       caller first. A person's schoolId is nulled automatically when their
       school is deleted (onDelete: "set null"), so it is a reachable state,
       not a hypothetical one. */
    let scopedSchoolId: number | null;
    try {
      scopedSchoolId = effectiveSchoolId(currentUser);
    } catch (err) {
      if (err instanceof NoSchoolAssignedError) {
        res.status(403).json({ error: "No school assigned to this user" });
        return;
      }
      throw err;
    }

    const person = await db.query.people.findFirst({
      where: eq(people.employeeId, employeeId),
    });
    if (!person) { res.status(404).json({ error: "Person not found" }); return; }

    /* School-scope check.

       Must go through canAccessSchoolScopedRecord. The bare comparison this
       replaced — person.schoolId !== currentUser.schoolId — is fail-OPEN:
       when both sides are null it is false, so a caller with no school was
       granted access to every person with no school. */
    if (!canAccessSchoolScopedRecord(currentUser, person.schoolId)) {
      res.status(403).json({ error: "Cannot access people from another school" });
      return;
    }

    /* Rubric slugs repeat year over year — pair the slug with the active
       school year or this resolves to the oldest copy and finds no scores. */
    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." });
      return;
    }

    const quarter = await db.query.rubricSets.findFirst({
      where: and(eq(rubricSets.slug, quarterSlug), eq(rubricSets.schoolYearId, activeYearId)),
    });
    if (!quarter) { res.status(404).json({ error: "Rubric set not found" }); return; }

    /* Undefined (= no filter) only for network roles, which scopedSchoolId
       represents as null. Previously this also fell through to no filter
       when a school-scoped caller had no schoolId, returning that person's
       observations from every school. */
    const schoolObsFilter = scopedSchoolId !== null
      ? eq(observations.schoolId, scopedSchoolId)
      : undefined;

    const obsRows = await db.select().from(observations)
      .where(and(
        eq(observations.observedEmployeeId, employeeId),
        eq(observations.rubricSetId, quarter.id),
        ne(observations.status, "draft"),
        schoolObsFilter,
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

    /* Batch-fetch observer names/emails from people */
    const observerIds = [...new Set(
      obsRows.map((o) => o.observerEmployeeId).filter((id): id is string => id != null),
    )];
    const observerMap = await fetchObserverInfo(observerIds);

    res.json({
      id:         person.employeeId,
      name:       `${person.firstName} ${person.lastName}`.trim(),
      firstName:  person.firstName,
      lastName:   person.lastName,
      employeeId: person.employeeId,
      email:      person.email,
      subject:    person.department,
      /* Nullable in the database, string[] in the published type. */
      gradeLevel: person.gradeLevel ?? [],
      observations: obsRows
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((o) => ({
          id:                 String(o.id),
          date:               o.date,
          strengths:          o.strengths ?? undefined,
          growthAreas:        o.growthAreas ?? undefined,
          observer:           o.observerEmployeeId ? (observerMap.get(o.observerEmployeeId)?.name ?? "") : "",
          observerEmployeeId: o.observerEmployeeId ?? undefined,
          observerEmail:      o.observerEmployeeId ? (observerMap.get(o.observerEmployeeId)?.email ?? undefined) : undefined,
          scores:             scoresByObs.get(o.id) ?? {},
        })),
    });
  } catch (err) {
    console.error("GET /teachers/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
