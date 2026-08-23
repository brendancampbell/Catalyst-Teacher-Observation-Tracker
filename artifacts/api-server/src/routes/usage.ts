/**
 * GET /api/usage — who is actually using Catalyst, and how much.
 *
 * One row per person who can observe, for the CURRENT school year:
 * when they last used it, how many days they used it, how many observations
 * they published, and how many action steps they assigned.
 *
 * ── Two things worth knowing about the numbers ────────────────────────────
 * "Days used" is not sign-ins. Sessions last seven days and the cookie is not
 * rolling, so somebody who opens Catalyst daily authenticates about four times
 * a month — counting sign-ins would show the most active person in the network
 * as barely present. user_activity_days holds one row per person per day they
 * did anything, which is the honest measure.
 *
 * Recording began 2026-08-21. Anything before that does not exist and cannot
 * be recovered, which is why this shipped before the report that reads it.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 * Coaches and school leaders see their own school. Network leaders and admins
 * see everyone, optionally narrowed to one school. That is wider than a
 * management report usually gets — a coach can see other coaches at their
 * school — and it was asked for deliberately.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  people, schools, observations, actionSteps, actionStepExtensions, userActivityDays, schoolYears,
} from "@workspace/db/schema";
import { and, eq, inArray, ne, gte, asc, count, max } from "drizzle-orm";
import { getActiveSchoolYearId } from "../lib/active-school-year";
import { requireAuth, assertNetworkSchoolAccess } from "../middleware/auth";

const router = Router();

/** Everyone who can record an observation. NO_ACCESS is excluded by omission. */
const OBSERVING_ROLES = ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"] as const;

router.get("/", requireAuth, async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkScope =
      currentUser.role === "NETWORK_ADMIN" || currentUser.role === "NETWORK_LEADER";

    const requested = req.query.schoolId ? Number(req.query.schoolId) : null;
    if (requested !== null && !Number.isInteger(requested)) {
      res.status(400).json({ error: "Invalid schoolId" }); return;
    }

    /*
     * School users are pinned to their own school regardless of what they ask
     * for — the same fail-closed shape the people and action-step routes use.
     */
    let scopedSchoolId: number | null;
    if (isNetworkScope) {
      if (requested !== null) {
        const access = await assertNetworkSchoolAccess(currentUser, requested);
        if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
      }
      scopedSchoolId = requested;
    } else {
      if (!currentUser.schoolId) {
        res.status(403).json({ error: "No school assigned to this user" }); return;
      }
      scopedSchoolId = currentUser.schoolId;
    }

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." }); return;
    }

    /*
     * Activity is dated, not year-scoped — the table records a day, and days do
     * not know which school year they fall in. Bound by the year's start date
     * where there is one. Where there is not, count everything: recording only
     * began this August, so in practice the two are the same.
     */
    const [yearRow] = await db
      .select({ startDate: schoolYears.startDate, name: schoolYears.name })
      .from(schoolYears).where(eq(schoolYears.id, activeYearId)).limit(1);
    const yearStart = yearRow?.startDate ?? null;

    /* ── The people ── */
    const rows = await db
      .select({
        employeeId: people.employeeId,
        firstName:  people.firstName,
        lastName:   people.lastName,
        role:       people.role,
        schoolId:   people.schoolId,
        schoolName: schools.displayName,
      })
      .from(people)
      .leftJoin(schools, eq(schools.id, people.schoolId))
      .where(and(
        eq(people.isActive, true),
        inArray(people.role, [...OBSERVING_ROLES]),
        ...(scopedSchoolId !== null ? [eq(people.schoolId, scopedSchoolId)] : []),
      ))
      .orderBy(asc(people.lastName), asc(people.firstName));

    const ids = rows.map((r) => r.employeeId);
    if (ids.length === 0) { res.json({ schoolYear: yearRow?.name ?? null, rows: [] }); return; }

    /* ── Activity: last day used, and how many days ── */
    const activity = await db
      .select({
        employeeId: userActivityDays.employeeId,
        lastUsed:   max(userActivityDays.activityDate),
        daysUsed:   count(),
      })
      .from(userActivityDays)
      .where(and(
        inArray(userActivityDays.employeeId, ids),
        ...(yearStart ? [gte(userActivityDays.activityDate, yearStart)] : []),
      ))
      .groupBy(userActivityDays.employeeId);

    /* ── Observations they published ── */
    const obs = await db
      .select({ employeeId: observations.observerEmployeeId, n: count() })
      .from(observations)
      .where(and(
        inArray(observations.observerEmployeeId, ids),
        eq(observations.schoolYearId, activeYearId),
        /* Drafts are not finished work; counting them would reward starting. */
        ne(observations.status, "draft"),
      ))
      .groupBy(observations.observerEmployeeId);

    /* ── Action steps they assigned ── */
    const steps = await db
      .select({ employeeId: actionSteps.assignedByEmployeeId, n: count() })
      .from(actionSteps)
      .where(and(
        inArray(actionSteps.assignedByEmployeeId, ids),
        eq(actionSteps.schoolYearId, activeYearId),
      ))
      .groupBy(actionSteps.assignedByEmployeeId);

    /*
     * Extensions count too — revisiting a step with a teacher is coaching
     * work, even though it does not create a new step. Extensions carry no
     * school year of their own, so they are scoped through the step they
     * belong to.
     */
    const extensions = await db
      .select({ employeeId: actionStepExtensions.extendedByEmployeeId, n: count() })
      .from(actionStepExtensions)
      .innerJoin(actionSteps, eq(actionSteps.id, actionStepExtensions.actionStepId))
      .where(and(
        inArray(actionStepExtensions.extendedByEmployeeId, ids),
        eq(actionSteps.schoolYearId, activeYearId),
      ))
      .groupBy(actionStepExtensions.extendedByEmployeeId);

    const byId = <T extends { employeeId: string | null }>(list: T[]) =>
      new Map(list.filter((r) => r.employeeId).map((r) => [r.employeeId!, r]));

    const activityMap = byId(activity);
    const obsMap = byId(obs);
    const stepMap = byId(steps);
    const extMap = byId(extensions);

    res.json({
      schoolYear: yearRow?.name ?? null,
      recordingSince: "2026-08-21",
      rows: rows.map((r) => ({
        employeeId:  r.employeeId,
        name:        `${r.firstName} ${r.lastName}`.trim(),
        role:        r.role,
        schoolId:    r.schoolId,
        schoolName:  r.schoolName ?? null,
        lastUsed:    activityMap.get(r.employeeId)?.lastUsed ?? null,
        daysUsed:    Number(activityMap.get(r.employeeId)?.daysUsed ?? 0),
        observations: Number(obsMap.get(r.employeeId)?.n ?? 0),
        /* One number, as asked, with extensions folded in — the column header
           says so, since a coach who extended one step twelve times would
           otherwise look identical to one who set twelve. */
        actionSteps: Number(stepMap.get(r.employeeId)?.n ?? 0) + Number(extMap.get(r.employeeId)?.n ?? 0),
      })),
    });
  } catch (err) {
    console.error("GET /usage error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
