import { Router } from "express";
import { db } from "@workspace/db";
import { actionSteps, actionStepExtensions, people, schools } from "@workspace/db/schema";
import { eq, and, desc, lt, sql, asc, inArray } from "drizzle-orm";
import { getActiveSchoolYearId } from "../lib/active-school-year";
import { requireAuth, effectiveSchoolId, NoSchoolAssignedError, assertNetworkSchoolAccess } from "../middleware/auth";

const router = Router();

/**
 * Extension history for a set of action steps, in one query.
 *
 * Returns how many times each step's due date has been pushed back and what it
 * was originally due. Both matter to a coach: three extensions on one step is
 * the signal that a teacher is stuck, and it is invisible if you only ever see
 * the current date.
 *
 * originalDueDate comes from the OLDEST extension's previous_due_date, so it
 * is the date the step was first assigned with, not the date before the most
 * recent push.
 */
async function loadExtensionSummary(
  stepIds: number[],
): Promise<Map<number, { count: number; originalDueDate: string }>> {
  const out = new Map<number, { count: number; originalDueDate: string }>();
  if (stepIds.length === 0) return out;

  const rows = await db
    .select({
      actionStepId:    actionStepExtensions.actionStepId,
      previousDueDate: actionStepExtensions.previousDueDate,
    })
    .from(actionStepExtensions)
    .where(inArray(actionStepExtensions.actionStepId, stepIds))
    .orderBy(asc(actionStepExtensions.createdAt), asc(actionStepExtensions.id));

  for (const row of rows) {
    const seen = out.get(row.actionStepId);
    /* Ordered oldest first, so the first one seen carries the original date. */
    if (seen) seen.count += 1;
    else out.set(row.actionStepId, { count: 1, originalDueDate: row.previousDueDate });
  }
  return out;
}


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

    const extensions = await loadExtensionSummary(rows.map((r) => r.id));

    res.json(rows.map((r) => ({
      extensionCount:              extensions.get(r.id)?.count ?? 0,
      originalDueDate:             extensions.get(r.id)?.originalDueDate ?? r.dueDate,
      id:                          r.id,
      teacherEmployeeId:           r.teacherEmployeeId,
      assignedByEmployeeId:        r.assignedByEmployeeId ?? undefined,
      assignedByName:              r.assignedByFirst ? `${r.assignedByFirst} ${r.assignedByLast ?? ""}`.trim() : undefined,
      assignedDuringObservationId: r.assignedDuringObservationId != null ? String(r.assignedDuringObservationId) : undefined,
      text:                        r.text,
      dueDate:                     r.dueDate,
      status:                      r.status,
      masteredAt:                  r.masteredAt?.toISOString() ?? undefined,
      masteredByEmployeeId:        r.masteredByEmployeeId ?? undefined,
      masteredByName:              r.masteredByEmployeeId ? (masteredByMap.get(r.masteredByEmployeeId) ?? undefined) : undefined,
      masteredDuringObservationId: r.masteredDuringObservationId != null ? String(r.masteredDuringObservationId) : undefined,
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
      assignedDuringObservationId: r.assignedDuringObservationId != null ? String(r.assignedDuringObservationId) : undefined,
      text:                        r.text,
      dueDate:                     r.dueDate,
      status:                      r.status,
      masteredAt:                  r.masteredAt?.toISOString() ?? undefined,
      masteredByEmployeeId:        r.masteredByEmployeeId ?? undefined,
      masteredDuringObservationId: r.masteredDuringObservationId != null ? String(r.masteredDuringObservationId) : undefined,
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

    const overdueExtensions = await loadExtensionSummary(rows.map((r) => r.id));

    res.json(rows.map((r) => {
      const daysOverdue = Math.floor((Date.now() - new Date(r.dueDate).getTime()) / 86_400_000);
      const ext = overdueExtensions.get(r.id);
      return {
        /* A step overdue AFTER being extended twice is a different situation
           from one overdue for the first time, and the Action Center is where
           that difference is worth seeing. */
        extensionCount:   ext?.count ?? 0,
        originalDueDate:  ext?.originalDueDate ?? r.dueDate,
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

/* ── PATCH /api/action-steps/:id/unmaster ────────────────────────────
   Reverse a mastery, putting the step back to open.

   Mastery used to be one-way: marking it was a click, and editing a mastered
   step is refused by business rule, so a misclick could not be undone from the
   interface at all.

   Deliberately a quiet revert rather than a recorded event. This exists to fix
   a mistake, so the step goes back to exactly how it was — including its
   original due date, which may well put it straight back on the overdue list.
   That is correct: undoing a mastery means the work was never finished.

   Same permissions as marking it, which is the symmetry that makes it usable:
   whoever can say "done" can say "not done after all".                     */
router.patch("/:id/unmaster", requireAuth, async (req, res) => {
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
    /* A step from a previous year is not editable at all — same rule as
       marking, and the reason mastery cannot be reversed across a rollover. */
    if (step.schoolYearId !== activeYearId) {
      res.status(404).json({ error: "Action step not found" }); return;
    }

    const access = assertStepAccess(currentUser.role, currentUser.schoolId, step.snapshotSchoolId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }

    if (step.status !== "mastered") {
      res.status(400).json({ error: "Action step is not mastered" }); return;
    }

    const [updated] = await db.update(actionSteps)
      .set({
        status:                      "open",
        masteredAt:                  null,
        masteredByEmployeeId:        null,
        /* Cleared too, or the step would still claim it was mastered during
           an observation that no longer says so. The observation itself is
           left alone — it happened, and its record stands. */
        masteredDuringObservationId: null,
        updatedAt:                   new Date(),
      })
      .where(eq(actionSteps.id, stepId))
      .returning();

    res.json({ ok: true, actionStep: updated });
  } catch (err) {
    console.error("PATCH /action-steps/:id/unmaster error:", err);
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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        res.status(400).json({ error: "dueDate must be a valid ISO date (YYYY-MM-DD)" }); return;
      }
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
