import { Router } from "express";
import { db } from "@workspace/db";
import { people, schools, observations } from "@workspace/db/schema";
import { eq, and, max, sql } from "drizzle-orm";
import { requireNetworkScope, effectiveSchoolId, NoSchoolAssignedError } from "../middleware/auth";

const router = Router();

async function assertSchoolExists(id: number): Promise<boolean> {
  const rows = await db.select({ id: schools.id }).from(schools).where(eq(schools.id, id)).limit(1);
  return rows.length > 0;
}

/* ── GET /api/action-center/network ──────────────────────────────
   Network action center — NETWORK_LEADER and NETWORK_ADMIN only.
   Accepts an optional ?schoolId= query param to filter by school. */
router.get("/network", requireNetworkScope, async (req, res) => {
  try {
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" }); return;
    }
    if (requested !== null && !(await assertSchoolExists(requested))) {
      res.status(404).json({ error: "School not found" }); return;
    }

    const rows = await db
      .select({
        employeeId:     people.employeeId,
        personFirst:    people.firstName,
        personLast:     people.lastName,
        department:     people.department,
        gradeLevel:     people.gradeLevel,
        schoolName:     schools.name,
        rescoreDueDate: people.rescoreDueDate,
        needsRescore:   people.needsRescore,
      })
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(
        requested !== null
          ? and(eq(people.needsRescore, true), eq(people.schoolId, requested), eq(people.includeInFeedbackTracker, true))
          : and(eq(people.needsRescore, true), eq(people.includeInFeedbackTracker, true)),
      )
      .orderBy(people.rescoreDueDate);

    res.json(rows.map((r) => ({
      ...r,
      teacherName: `${r.personFirst} ${r.personLast}`.trim(),
    })));
  } catch (err) {
    console.error("GET /action-center/network error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/action-center/rescore-queue ───────────────────────── */
router.get("/rescore-queue", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" }); return;
    }
    if (requested !== null && !(await assertSchoolExists(requested))) {
      res.status(404).json({ error: "School not found" }); return;
    }
    const scopedSchoolId = effectiveSchoolId(user, requested);

    const rows = await db
      .select({
        employeeId:     people.employeeId,
        personFirst:    people.firstName,
        personLast:     people.lastName,
        department:     people.department,
        gradeLevel:     people.gradeLevel,
        schoolName:     schools.name,
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
router.get("/overdue-observations", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" }); return;
    }
    if (requested !== null && !(await assertSchoolExists(requested))) {
      res.status(404).json({ error: "School not found" }); return;
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
        schoolName:   schools.name,
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
      .groupBy(people.employeeId, people.firstName, people.lastName, people.department, people.gradeLevel, schools.name)
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
