import { Router } from "express";
import { db } from "@workspace/db";
import { actionSteps, people, observations, schools } from "@workspace/db/schema";
import { eq, and, desc, lt, sql, asc } from "drizzle-orm";
import { getActiveSchoolYearId } from "../lib/active-school-year";
import { requireAuth, effectiveSchoolId, NoSchoolAssignedError, assertNetworkSchoolAccess } from "../middleware/auth";

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

const router = Router();

/* ── Helper: assert caller may access an action step by its frozen school ──
   Accepts the step's already-fetched snapshotSchoolId (set at creation time)
   so there is no live people lookup and no post-transfer data leak.
   SCHOOL_LEADER and COACH: step's snapshotSchoolId must match callerSchoolId.
   NETWORK_LEADER / NETWORK_ADMIN: always allowed.
   Fails closed on null snapshotSchoolId (unattributable step).             */
function assertStepAccess(
  callerRole: string,
  callerSchoolId: number | null | undefined,
  snapshotSchoolId: number | null,
): { ok: true } | { ok: false; status: number; error: string } {
  if (callerRole === "SCHOOL_LEADER" || callerRole === "COACH") {
    if (!callerSchoolId) return { ok: false, status: 403, error: "No school assigned to this user" };
    if (snapshotSchoolId !== callerSchoolId) {
      return { ok: false, status: 403, error: "Cannot access action steps for a teacher outside your school" };
    }
  }
  return { ok: true };
}

/* ── GET /api/action-steps?teacherEmployeeId=X ──────────────────── */
router.get("/", requireAuth, async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const teacherEmployeeId = req.query.teacherEmployeeId as string | undefined;
    if (!teacherEmployeeId) {
      res.status(400).json({ error: "teacherEmployeeId query parameter is required" });
      return;
    }

    /* For SCHOOL_LEADER/COACH: scope the query to snapshotSchoolId = callerSchoolId
       so results are inherently restricted to steps created while the teacher
       belonged to this school — no live people lookup needed.               */
    if (currentUser.role === "SCHOOL_LEADER" || currentUser.role === "COACH") {
      if (!currentUser.schoolId) {
        res.status(403).json({ error: "No school assigned to this user" }); return;
      }
    }

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." }); return;
    }

    const schoolScopeCondition =
      (currentUser.role === "SCHOOL_LEADER" || currentUser.role === "COACH")
        ? eq(actionSteps.snapshotSchoolId, currentUser.schoolId!)
        : sql`1=1`;

    const rows = await db
      .select({
        id:                          actionSteps.id,
        teacherEmployeeId:           actionSteps.teacherEmployeeId,
        assignedByEmployeeId:        actionSteps.assignedByEmployeeId,
        assignedDuringObservationId: actionSteps.assignedDuringObservationId,
        text:                        actionSteps.text,
        dueDate:                     actionSteps.dueDate,
        status:                      actionSteps.status,
        masteredAt:                  actionSteps.masteredAt,
        masteredByEmployeeId:        actionSteps.masteredByEmployeeId,
        masteredDuringObservationId: actionSteps.masteredDuringObservationId,
        createdAt:                   actionSteps.createdAt,
        assignedByFirst:             people.firstName,
        assignedByLast:              people.lastName,
      })
      .from(actionSteps)
      .leftJoin(people, eq(people.employeeId, actionSteps.assignedByEmployeeId))
      .where(and(
        eq(actionSteps.teacherEmployeeId, teacherEmployeeId),
        eq(actionSteps.schoolYearId, activeYearId),
        schoolScopeCondition,
      ))
      .orderBy(desc(actionSteps.createdAt));

    /* Fetch masteredBy names in one query */
    const masteredByIds = [...new Set(rows.map((r) => r.masteredByEmployeeId).filter(Boolean) as string[])];
    const masteredByMap = new Map<string, string>();
    if (masteredByIds.length > 0) {
      const masteredPeople = await db.query.people.findMany({
        where: (p, { inArray }) => inArray(p.employeeId, masteredByIds),
      });
      for (const p of masteredPeople) {
        masteredByMap.set(p.employeeId, `${p.firstName} ${p.lastName}`.trim());
      }
    }

    res.json(rows.map((r) => ({
      id:                          r.id,
      teacherEmployeeId:           r.teacherEmployeeId,
      assignedByEmployeeId:        r.assignedByEmployeeId ?? undefined,
      assignedByName:              r.assignedByFirst ? `${r.assignedByFirst} ${r.assignedByLast ?? ""}`.trim() : undefined,
      assignedDuringObservationId: r.assignedDuringObservationId ?? undefined,
      text:                        r.text,
      dueDate:                     r.dueDate,
      status:                      r.status,
      masteredAt:                  r.masteredAt?.toISOString() ?? undefined,
      masteredByEmployeeId:        r.masteredByEmployeeId ?? undefined,
      masteredByName:              r.masteredByEmployeeId ? (masteredByMap.get(r.masteredByEmployeeId) ?? undefined) : undefined,
      masteredDuringObservationId: r.masteredDuringObservationId ?? undefined,
      createdAt:                   r.createdAt.toISOString(),
    })));
  } catch (err) {
    console.error("GET /action-steps error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/action-steps/latest?teacherEmployeeId=X ──────────── */
router.get("/latest", requireAuth, async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const teacherEmployeeId = req.query.teacherEmployeeId as string | undefined;
    if (!teacherEmployeeId) {
      res.status(400).json({ error: "teacherEmployeeId query parameter is required" });
      return;
    }

    if (currentUser.role === "SCHOOL_LEADER" || currentUser.role === "COACH") {
      if (!currentUser.schoolId) {
        res.status(403).json({ error: "No school assigned to this user" }); return;
      }
    }

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." }); return;
    }

    const schoolScopeCondition =
      (currentUser.role === "SCHOOL_LEADER" || currentUser.role === "COACH")
        ? eq(actionSteps.snapshotSchoolId, currentUser.schoolId!)
        : sql`1=1`;

    const rows = await db
      .select({
        id:                          actionSteps.id,
        teacherEmployeeId:           actionSteps.teacherEmployeeId,
        assignedByEmployeeId:        actionSteps.assignedByEmployeeId,
        assignedDuringObservationId: actionSteps.assignedDuringObservationId,
        text:                        actionSteps.text,
        dueDate:                     actionSteps.dueDate,
        status:                      actionSteps.status,
        masteredAt:                  actionSteps.masteredAt,
        masteredByEmployeeId:        actionSteps.masteredByEmployeeId,
        masteredDuringObservationId: actionSteps.masteredDuringObservationId,
        createdAt:                   actionSteps.createdAt,
        assignedByFirst:             people.firstName,
        assignedByLast:              people.lastName,
      })
      .from(actionSteps)
      .leftJoin(people, eq(people.employeeId, actionSteps.assignedByEmployeeId))
      .where(and(
        eq(actionSteps.teacherEmployeeId, teacherEmployeeId),
        eq(actionSteps.schoolYearId, activeYearId),
        schoolScopeCondition,
      ))
      .orderBy(desc(actionSteps.createdAt))
      .limit(1);

    if (rows.length === 0) {
      res.json(null);
      return;
    }

    const r = rows[0]!;
    res.json({
      id:                          r.id,
      teacherEmployeeId:           r.teacherEmployeeId,
      assignedByEmployeeId:        r.assignedByEmployeeId ?? undefined,
      assignedByName:              r.assignedByFirst ? `${r.assignedByFirst} ${r.assignedByLast ?? ""}`.trim() : undefined,
      assignedDuringObservationId: r.assignedDuringObservationId ?? undefined,
      text:                        r.text,
      dueDate:                     r.dueDate,
      status:                      r.status,
      masteredAt:                  r.masteredAt?.toISOString() ?? undefined,
      masteredByEmployeeId:        r.masteredByEmployeeId ?? undefined,
      masteredDuringObservationId: r.masteredDuringObservationId ?? undefined,
      createdAt:                   r.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("GET /action-steps/latest error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/action-steps/overdue ──────────────────────────────── */
router.get("/overdue", requireAuth, async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" }); return;
    }
    if (requested !== null) {
      const access = await assertNetworkSchoolAccess(currentUser, requested);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    }
    const scopedSchoolId = effectiveSchoolId(currentUser, requested);

    const today = new Date().toISOString().split("T")[0]!;

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." }); return;
    }

    const rows = await db
      .select({
        id:                          actionSteps.id,
        teacherEmployeeId:           actionSteps.teacherEmployeeId,
        teacherFirst:                people.firstName,
        teacherLast:                 people.lastName,
        schoolName:                  schools.displayName,
        text:                        actionSteps.text,
        dueDate:                     actionSteps.dueDate,
        assignedByEmployeeId:        actionSteps.assignedByEmployeeId,
        createdAt:                   actionSteps.createdAt,
      })
      .from(actionSteps)
      .innerJoin(people, eq(people.employeeId, actionSteps.teacherEmployeeId))
      .leftJoin(schools, eq(schools.id, people.schoolId))
      .where(
        and(
          eq(actionSteps.status, "open"),
          lt(actionSteps.dueDate, today),
          eq(actionSteps.schoolYearId, activeYearId),
          scopedSchoolId !== null ? eq(people.schoolId, scopedSchoolId) : sql`1=1`,
        ),
      )
      .orderBy(asc(actionSteps.dueDate));

    /* Fetch assigner names */
    const assignerIds = [...new Set(rows.map((r) => r.assignedByEmployeeId).filter(Boolean) as string[])];
    const assignerMap = new Map<string, string>();
    if (assignerIds.length > 0) {
      const assigners = await db.query.people.findMany({
        where: (p, { inArray }) => inArray(p.employeeId, assignerIds),
      });
      for (const p of assigners) {
        assignerMap.set(p.employeeId, `${p.firstName} ${p.lastName}`.trim());
      }
    }

    res.json(rows.map((r) => {
      const daysOverdue = Math.floor((Date.now() - new Date(r.dueDate).getTime()) / 86_400_000);
      return {
        id:               r.id,
        teacherEmployeeId: r.teacherEmployeeId,
        teacherName:      `${r.teacherFirst} ${r.teacherLast}`.trim(),
        schoolName:       r.schoolName ?? undefined,
        text:             r.text,
        dueDate:          r.dueDate,
        daysOverdue,
        assignedByEmployeeId: r.assignedByEmployeeId ?? undefined,
        assignerName:     r.assignedByEmployeeId ? (assignerMap.get(r.assignedByEmployeeId) ?? undefined) : undefined,
      };
    }));
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("GET /action-steps/overdue error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PATCH /api/action-steps/:id/master ─────────────────────────── */
router.patch("/:id/master", requireAuth, async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const stepId = Number(req.params.id);
    if (!Number.isFinite(stepId)) {
      res.status(400).json({ error: "Invalid action step id" }); return;
    }

    const step = await db.query.actionSteps.findFirst({ where: eq(actionSteps.id, stepId) });
    if (!step) { res.status(404).json({ error: "Action step not found" }); return; }

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." }); return;
    }
    if (step.schoolYearId !== activeYearId) {
      res.status(404).json({ error: "Action step not found" }); return;
    }

    const access = assertStepAccess(currentUser.role, currentUser.schoolId, step.snapshotSchoolId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }

    if (step.status === "mastered") { res.status(400).json({ error: "Action step is already mastered" }); return; }

    const [updated] = await db.update(actionSteps)
      .set({
        status:              "mastered",
        masteredAt:          new Date(),
        masteredByEmployeeId: currentUser.employeeId,
      })
      .where(eq(actionSteps.id, stepId))
      .returning();

    res.json({ ok: true, actionStep: updated });
  } catch (err) {
    console.error("PATCH /action-steps/:id/master error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PATCH /api/action-steps/:id ─────────────────────────────────── */
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const stepId = Number(req.params.id);
    if (!Number.isFinite(stepId)) {
      res.status(400).json({ error: "Invalid action step id" }); return;
    }

    const step = await db.query.actionSteps.findFirst({ where: eq(actionSteps.id, stepId) });
    if (!step) { res.status(404).json({ error: "Action step not found" }); return; }

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." }); return;
    }
    if (step.schoolYearId !== activeYearId) {
      res.status(404).json({ error: "Action step not found" }); return;
    }

    const access = assertStepAccess(currentUser.role, currentUser.schoolId, step.snapshotSchoolId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }

    if (step.status === "mastered") { res.status(400).json({ error: "Cannot edit a mastered action step" }); return; }

    const { text, dueDate } = req.body;
    if (text === undefined && dueDate === undefined) {
      res.status(400).json({ error: "At least one of text or dueDate must be provided" }); return;
    }

    if (dueDate !== undefined) {
      const today = new Date().toISOString().split("T")[0]!;
      if (dueDate < today) {
        res.status(400).json({ error: "dueDate must be today or in the future" }); return;
      }
    }

    const [updated] = await db.update(actionSteps)
      .set({
        text:    text    !== undefined ? String(text)    : step.text,
        dueDate: dueDate !== undefined ? String(dueDate) : step.dueDate,
      })
      .where(eq(actionSteps.id, stepId))
      .returning();

    res.json({ ok: true, actionStep: updated });
  } catch (err) {
    console.error("PATCH /action-steps/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
