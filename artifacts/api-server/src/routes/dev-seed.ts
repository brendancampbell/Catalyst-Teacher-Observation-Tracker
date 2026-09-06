/**
 * Dev-only seeding helpers for Playwright E2E tests.
 *
 * Routes are only registered when NODE_ENV !== 'production' (see routes/index.ts).
 * They bypass the normal API date-validation guards so tests can insert rows with
 * past due dates without needing direct DB access from the browser.
 *
 * POST   /api/dev/overdue-action-step   — insert an open action step with a past due date
 * DELETE /api/dev/overdue-action-step/:id — delete the seeded step (cleanup)
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { actionSteps, people } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { isDevelopment } from "../config/env";
import { getActiveSchoolYearId } from "../lib/active-school-year";

const router = Router();

/* ── POST /api/dev/overdue-action-step ──────────────────────────────────────
   Body: {
     teacherEmployeeId:    string   — employee ID of the teacher
     assignedByEmployeeId: string   — employee ID of the assigning user
     text:                 string   — action step text
     dueDate:              string   — ISO date in the past, e.g. "2025-01-01"
   }
   Response: { ok: true, id: number }
*/
router.post("/overdue-action-step", async (req, res) => {
  if (!isDevelopment) { res.status(404).json({ error: "Not found" }); return; }

  const { teacherEmployeeId, assignedByEmployeeId, text, dueDate } = req.body as {
    teacherEmployeeId?:    unknown;
    assignedByEmployeeId?: unknown;
    text?:                 unknown;
    dueDate?:              unknown;
  };

  if (typeof teacherEmployeeId !== "string" || !teacherEmployeeId.trim()) {
    res.status(400).json({ error: "teacherEmployeeId (string) required" }); return;
  }
  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text (string) required" }); return;
  }
  if (typeof dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    res.status(400).json({ error: "dueDate (YYYY-MM-DD string) required" }); return;
  }

  try {
    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured" }); return;
    }

    const teacher = await db.query.people.findFirst({
      where: eq(people.employeeId, teacherEmployeeId.trim()),
    });
    if (!teacher) {
      res.status(404).json({ error: `Teacher not found: ${teacherEmployeeId}` }); return;
    }

    const [step] = await db
      .insert(actionSteps)
      .values({
        teacherEmployeeId:    teacherEmployeeId.trim(),
        assignedByEmployeeId: typeof assignedByEmployeeId === "string" ? assignedByEmployeeId.trim() : null,
        schoolYearId:         activeYearId,
        snapshotSchoolId:     teacher.schoolId ?? null,
        text:                 text.trim(),
        dueDate:              dueDate,
        status:               "open",
      })
      .returning({ id: actionSteps.id });

    res.json({ ok: true, id: step!.id });
  } catch (err) {
    console.error("POST /dev/overdue-action-step error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── DELETE /api/dev/overdue-action-step/:id ────────────────────────────────
   Deletes the seeded step regardless of status (cleanup after test).
   Response: { ok: true }
*/
router.delete("/overdue-action-step/:id", async (req, res) => {
  if (!isDevelopment) { res.status(404).json({ error: "Not found" }); return; }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }

  try {
    await db.delete(actionSteps).where(eq(actionSteps.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /dev/overdue-action-step/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
