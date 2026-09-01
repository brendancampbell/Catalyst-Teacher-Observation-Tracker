import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db, pool } from "@workspace/db";
import { PgRateLimitStore } from "../lib/pg-rate-limit-store";
import { dashboardCache } from "./dashboard";
import { districtCache }  from "./district";
import { networkAvgsCache } from "./action-center";
import {
  observations, observationScores, people, rubricSets, schools,
  rubricCategories, rubricDomains, observationScoreValueSchema,
  actionSteps, actionStepExtensions, schoolYears,
} from "@workspace/db/schema";
import { eq, desc, and, ne, inArray, isNotNull } from "drizzle-orm";
import { getActiveSchoolYearId } from "../lib/active-school-year";
import { canAccessSchoolScopedRecord } from "../middleware/auth";
import { validateExtensionRequest, checkStepIsExtendable, type ExtendActionStepInput } from "../lib/action-step-extension.js";
import { rescoreDueDateFor, recomputeRescoreForTeacher } from "../lib/system-settings";

const router = Router();

/* ── Per-user rate limiter for mutation endpoints ────────────────────
   Limits PUT and DELETE per 15-minute window per user (or IP when
   unauthenticated). Blunts brute-force ID enumeration.

   The budget is sized for draft autosave, which PUTs the same observation
   about 2s after any form change. Scoring a dozen domains and editing the
   strengths/growth-areas fields costs roughly 5-10 PUTs per observation, so
   a principal doing several observations back to back was capable of
   exhausting the previous 30-request budget mid-draft — surfacing as
   autosave silently failing with a 429 while they were still typing.
   120 clears realistic drafting by a wide margin and still bounds
   scripted enumeration.                                                */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const observationMutationLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: 120,
  /* Use a persistent PostgreSQL store in production so counters survive
     server restarts, deploys, and crash/scale events.  The default
     in-memory store is kept for local development (faster, no side-effects
     in test runs that use a fresh process each time).               */
  store: process.env.NODE_ENV === "production"
    ? new PgRateLimitStore(pool, RATE_LIMIT_WINDOW_MS)
    : undefined,
  keyGenerator: (req) => {
    const user = req.user as Express.User | undefined;
    return user?.employeeId ?? ipKeyGenerator(req.ip ?? "");
  },
  handler: (req, res) => {
    req.log.warn(
      {
        event:             "observation_mutation_rate_limit_exceeded",
        actingEmployeeId:  (req.user as Express.User | undefined)?.employeeId,
        path:              req.path,
        method:            req.method,
      },
      "observation mutation rate limit exceeded",
    );
    res.status(429).json({ error: "Too many requests. Please try again later." });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

/* ── Per-user rate limiter for observation creation ──────────────────
   Deliberately a SEPARATE budget from the mutation limiter above, not a
   shared one. Draft autosave PUTs the same observation every ~2s of idle
   typing, so PUT traffic is high-volume and already spends most of the
   30-request mutation budget. Folding POST into that bucket would make a
   normal drafting session more likely to hit the limit.

   Creation is low-volume by nature — a busy day of observations is well
   under 20 — so 60 per 15-minute window never troubles real use while
   still bounding automated row creation.                               */
const observationCreateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: 60,
  store: process.env.NODE_ENV === "production"
    ? new PgRateLimitStore(pool, RATE_LIMIT_WINDOW_MS)
    : undefined,
  keyGenerator: (req) => {
    const user = req.user as Express.User | undefined;
    return user?.employeeId ?? ipKeyGenerator(req.ip ?? "");
  },
  handler: (req, res) => {
    req.log.warn(
      {
        event:            "observation_create_rate_limit_exceeded",
        actingEmployeeId: (req.user as Express.User | undefined)?.employeeId,
        path:             req.path,
      },
      "observation create rate limit exceeded",
    );
    res.status(429).json({ error: "Too many requests. Please try again later." });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

/* ── validateScores ──────────────────────────────────────────────────
   Returns { ok: true } when every entry in `scores` has a value in
   {0, 0.5, 1} AND every key is a domain slug that belongs to the
   given rubricSetId. Returns { ok: false, error } otherwise.
   Must be called BEFORE any observation_scores insert or delete so
   corrupt data never reaches the database.                           */
async function validateScores(
  scores: Record<string, unknown>,
  rubricSetId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const [slug, value] of Object.entries(scores)) {
    const parsed = observationScoreValueSchema.safeParse(Number(value));
    if (!parsed.success) {
      return {
        ok: false,
        error: `Invalid score for domain '${slug}': must be 0, 0.5, or 1 (got ${JSON.stringify(value)})`,
      };
    }
  }

  const validDomains = await db
    .select({ slug: rubricDomains.slug })
    .from(rubricDomains)
    .innerJoin(rubricCategories, eq(rubricDomains.categoryId, rubricCategories.id))
    .where(eq(rubricCategories.rubricSetId, rubricSetId));

  const validSlugs = new Set(validDomains.map((d) => d.slug));

  for (const slug of Object.keys(scores)) {
    if (!validSlugs.has(slug)) {
      return {
        ok: false,
        error: `Unknown domain slug '${slug}' for rubric set ${rubricSetId}`,
      };
    }
  }

  return { ok: true };
}

/* ── fetchObserverInfo ────────────────────────────────────────────────
   Batch-fetches observer name and email for a set of employeeIds.
   Returns a map of employeeId → { name, email }.                      */
async function fetchObserverInfo(
  ids: string[],
): Promise<Map<string, { name: string; email: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      employeeId: people.employeeId,
      firstName:  people.firstName,
      lastName:   people.lastName,
      email:      people.email,
    })
    .from(people)
    .where(inArray(people.employeeId, ids));
  const map = new Map<string, { name: string; email: string }>();
  for (const r of rows) {
    map.set(r.employeeId, {
      name:  `${r.firstName} ${r.lastName}`.trim(),
      email: r.email,
    });
  }
  return map;
}

/* ── GET /api/observations/my-latest-rubric ─────────────────────────
   Returns the slug of the rubric set containing the current user's
   most recent PUBLISHED observation (by date). Returns { slug: null }
   if the user has no published observations recorded.                 */
router.get("/my-latest-rubric", async (req, res) => {
  const currentUser = req.user as Express.User;
  const activeYearId = await getActiveSchoolYearId();
  if (!activeYearId) {
    res.json({ slug: null });
    return;
  }
  const latest = await db
    .select({ slug: rubricSets.slug })
    .from(observations)
    .innerJoin(rubricSets, eq(rubricSets.id, observations.rubricSetId))
    .where(and(
      eq(observations.observerEmployeeId, currentUser.employeeId),
      ne(observations.status, "draft"),
      eq(observations.schoolYearId, activeYearId),
    ))
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

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.json([]);
      return;
    }

    const drafts = await db
      .select({
        id:                  observations.id,
        observedEmployeeId:  observations.observedEmployeeId,
        observerEmployeeId:  observations.observerEmployeeId,
        personFirst:         people.firstName,
        personLast:          people.lastName,
        rubricSetId:         observations.rubricSetId,
        rubricSetSlug:       rubricSets.slug,
        rubricSetName:       rubricSets.name,
        date:                observations.date,
        time:                observations.time,
        course:              observations.course,
        isWalkthrough:       observations.isWalkthrough,
        strengths:           observations.strengths,
        growthAreas:         observations.growthAreas,
        status:              observations.status,
        actionStepText:      actionSteps.text,
        actionStepDueDate:   actionSteps.dueDate,
        /* Where a draft's intended step lives now. The join above still fires
           for drafts created before that change, so both are read and the
           pending value wins. */
        pendingActionStepText:    observations.pendingActionStepText,
        pendingActionStepDueDate: observations.pendingActionStepDueDate,
      })
      .from(observations)
      .leftJoin(people,     eq(people.employeeId, observations.observedEmployeeId))
      .innerJoin(rubricSets, eq(rubricSets.id,    observations.rubricSetId))
      .leftJoin(actionSteps, eq(actionSteps.assignedDuringObservationId, observations.id))
      .where(and(
        eq(observations.observerEmployeeId, currentUser.employeeId),
        eq(observations.status, "draft"),
        eq(observations.target, "TEACHER"),
        eq(observations.schoolYearId, activeYearId),
      ))
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

    /* Derive observer display name from the people table.
       For drafts the observer is always the current user, but we look it
       up the same way as published observations for consistency.          */
    const observerIds = [...new Set(
      drafts.map((d) => d.observerEmployeeId).filter((id): id is string => id != null),
    )];
    const observerMap = await fetchObserverInfo(observerIds);

    res.json(drafts.map((d) => {
      const observerInfo = d.observerEmployeeId ? observerMap.get(d.observerEmployeeId) : undefined;
      return {
        id:                String(d.id),
        observedEmployeeId: d.observedEmployeeId ?? undefined,
        teacherName:       d.personFirst
          ? [d.personFirst, d.personLast].filter(Boolean).join(" ") || undefined
          : undefined,
        rubricSetId:      d.rubricSetId,
        rubricSetSlug:    d.rubricSetSlug,
        rubricSetName:    d.rubricSetName,
        date:             d.date,
        time:             d.time ?? undefined,
        course:           d.course ?? undefined,
        isWalkthrough:    d.isWalkthrough,
        strengths:        d.strengths ?? undefined,
        growthAreas:      d.growthAreas ?? undefined,
        /* One field either way, so the client does not have to know which
           era a draft comes from. */
        actionStepText:    d.pendingActionStepText    ?? d.actionStepText    ?? undefined,
        actionStepDueDate: d.pendingActionStepDueDate ?? d.actionStepDueDate ?? undefined,
        observer:         observerInfo?.name ?? currentUser.name ?? "",
        status:           d.status,
        scores:           scoresByObs.get(d.id) ?? {},
      };
    }));
  } catch (err) {
    console.error("GET /observations/drafts error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/observations ───────────────────────────────────────────
   Returns SCHOOL-target observations visible to the requester.
   - SCHOOL_LEADER: only observations where schoolId = currentUser.schoolId
   - NETWORK_LEADER / NETWORK_ADMIN: all SCHOOL-target observations
     (optionally filtered by ?schoolId=<id>)
   - Other roles: 403                                                    */
router.get("/", async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const role = currentUser.role;

    if (role !== "SCHOOL_LEADER" && role !== "NETWORK_LEADER" && role !== "NETWORK_ADMIN") {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    let schoolFilter: number | null = null;
    if (role === "SCHOOL_LEADER") {
      if (!currentUser.schoolId) {
        res.status(403).json({ error: "No school assigned to this user" });
        return;
      }
      schoolFilter = currentUser.schoolId;
    } else {
      const param = req.query.schoolId;
      if (param) schoolFilter = Number(param);
    }

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.json([]);
      return;
    }

    const conditions = [eq(observations.target, "SCHOOL"), eq(observations.schoolYearId, activeYearId)];
    if (schoolFilter !== null) conditions.push(eq(observations.schoolId, schoolFilter));

    const rows = await db
      .select()
      .from(observations)
      .where(and(...conditions))
      .orderBy(desc(observations.date));

    const ids = rows.map((o) => o.id);
    const allScores = ids.length > 0
      ? await db.select().from(observationScores).where(inArray(observationScores.observationId, ids))
      : [];

    const scoresByObs = new Map<number, Record<string, number>>();
    for (const s of allScores) {
      if (!scoresByObs.has(s.observationId)) scoresByObs.set(s.observationId, {});
      scoresByObs.get(s.observationId)![s.domainSlug] = s.score;
    }

    /* Batch-fetch observer names/emails from people table */
    const observerIds = [...new Set(
      rows.map((o) => o.observerEmployeeId).filter((id): id is string => id != null),
    )];
    const observerMap = await fetchObserverInfo(observerIds);

    res.json(rows.map((o) => {
      const observerInfo = o.observerEmployeeId ? observerMap.get(o.observerEmployeeId) : undefined;
      return {
        id:                 String(o.id),
        schoolId:           o.schoolId,
        target:             o.target,
        date:               o.date,
        strengths:          o.strengths ?? undefined,
        growthAreas:        o.growthAreas ?? undefined,
        observer:           observerInfo?.name ?? "",
        observerEmployeeId: o.observerEmployeeId ?? undefined,
        observerEmail:      observerInfo?.email ?? undefined,
        status:             o.status,
        scores:             scoresByObs.get(o.id) ?? {},
      };
    }));
  } catch (err) {
    console.error("GET /observations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/observations/:id ───────────────────────────────────────
   Returns a single observation.
   SCHOOL_LEADER access rules:
   - SCHOOL-target: allowed only if observation.schoolId === user.schoolId
   - TEACHER-target: allowed only if the observed person is in the same school */
router.get("/:id", async (req, res) => {
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
    if (!existing) {
      res.status(404).json({ error: "Observation not found" });
      return;
    }

    /* Strict school check using the observation's immutable schoolId.
       Rows with schoolId = null (legacy data), and callers with no school
       assigned, are both denied — see canAccessSchoolScopedRecord.        */
    if (!canAccessSchoolScopedRecord(currentUser, existing.schoolId)) {
      res.status(403).json({
        error: existing.target === "SCHOOL"
          ? "Cannot access observations for schools outside your school"
          : "Cannot access observations for people outside your school",
      });
      return;
    }

    const savedScores = await db.select().from(observationScores)
      .where(eq(observationScores.observationId, obsId));

    /* Derive observer name/email from the people table */
    const observerMap = await fetchObserverInfo(
      existing.observerEmployeeId ? [existing.observerEmployeeId] : [],
    );
    const observerInfo = existing.observerEmployeeId
      ? observerMap.get(existing.observerEmployeeId)
      : undefined;

    res.json({
      id:                 String(existing.id),
      date:               existing.date,
      time:               existing.time ?? undefined,
      course:             existing.course ?? undefined,
      isWalkthrough:      existing.isWalkthrough,
      strengths:          existing.strengths ?? undefined,
      growthAreas:        existing.growthAreas ?? undefined,
      observer:           observerInfo?.name ?? "",
      observerEmployeeId: existing.observerEmployeeId ?? undefined,
      observerEmail:      observerInfo?.email ?? undefined,
      status:             existing.status,
      target:             existing.target,
      schoolId:           existing.schoolId ?? undefined,
      scores:             Object.fromEntries(savedScores.map((s) => [s.domainSlug, s.score])),
    });
  } catch (err) {
    console.error("GET /observations/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/observations ─────────────────────────────────────────
   Body: { observedEmployeeId, rubricSetId, date, strengths?, growthAreas?,
           scores, isWalkthrough?, status?, target?,
           schoolId? }
   For target=SCHOOL: schoolId required, observedEmployeeId ignored,
   caller must be NETWORK_ADMIN.
   observerEmployeeId is ALWAYS derived from the authenticated session.
   observer name/email are derived from the observer's people record.   */
router.post("/", observationCreateLimiter, async (req, res) => {
  try {
    const {
      observedEmployeeId, teacherId,
      rubricSetId, quarterId, date, time, course, strengths, growthAreas,
      scores, isWalkthrough, status, target, schoolId,
    } = req.body;

    /* Legacy support: teacherId (old field) falls back to observedEmployeeId */
    const resolvedObservedId: string | undefined = observedEmployeeId ?? teacherId;
    const resolvedRubricSetId = rubricSetId ?? quarterId;
    const resolvedStatus: string = status === "draft" ? "draft" : "published";
    const resolvedTarget: "TEACHER" | "SCHOOL" = target === "SCHOOL" ? "SCHOOL" : "TEACHER";

    /* Validate `time` format early so clients get a 400, not a DB error.
       Accepted: HH:MM or HH:MM:SS (24-hour, hours 0-23, mins/secs 0-59). */
    if (time !== undefined && time !== null && time !== "") {
      if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(String(time))) {
        res.status(400).json({ error: "Invalid time format. Use HH:MM or HH:MM:SS (24-hour)." });
        return;
      }
    }

    /* Validate `date` the same way — shape first, then reject impossible
       calendar dates (e.g. 2026-02-31) which Postgres would otherwise turn
       into a 500. Absence is handled by the per-target required checks below. */
    if (date !== undefined && date !== null && date !== "") {
      const dateStr = String(date);
      const parsed  = new Date(`${dateStr}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ||
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== dateStr
      ) {
        res.status(400).json({ error: "Invalid date. Use a real calendar date in YYYY-MM-DD format." });
        return;
      }
    }

    const creator = req.user as Express.User;

    /* ── Active school year — required for all new records ─────────── */
    const activeYearRow = await db.query.schoolYears.findFirst({
      where: eq(schoolYears.status, "active"),
    });
    const activeYearId = activeYearRow?.id;
    if (!activeYearId) {
      res.status(400).json({ error: "No active school year configured" });
      return;
    }

    /* ── SCHOOL target ─────────────────────────────────────────────── */
    if (resolvedTarget === "SCHOOL") {
      if (creator.role !== "NETWORK_ADMIN" && creator.role !== "NETWORK_LEADER") {
        res.status(403).json({ error: "Only Network Admins and Network Leaders may create school-wide observations" });
        return;
      }
      if (!schoolId || !resolvedRubricSetId || !date) {
        res.status(400).json({ error: "schoolId, rubricSetId, and date are required for school observations" });
        return;
      }
      if (resolvedStatus === "published" && !scores) {
        res.status(400).json({ error: "scores are required for published observations" });
        return;
      }

      const school = await db.query.schools.findFirst({ where: eq(schools.id, Number(schoolId)) });
      if (!school) {
        res.status(404).json({ error: "School not found" });
        return;
      }

      if (scores && typeof scores === "object") {
        const scoreValidation = await validateScores(
          scores as Record<string, unknown>,
          Number(resolvedRubricSetId),
        );
        if (!scoreValidation.ok) {
          res.status(400).json({ error: scoreValidation.error });
          return;
        }
      }

      const [obs] = await db.insert(observations).values({
        observedEmployeeId:  null,
        schoolId:            Number(schoolId),
        schoolYearId:        activeYearId,
        rubricSetId:         Number(resolvedRubricSetId),
        date,
        time:                time || null,
        course:              course || null,
        strengths:           strengths || null,
        growthAreas:         growthAreas || null,
        observerEmployeeId:  creator.employeeId,
        /* Honoured now, where it used to be hardcoded false. It is a label
           and nothing more: the rescore queue below keys off
           observedEmployeeId, which is null on every SCHOOL-target row, so a
           school-wide walkthrough cannot flag anybody — deliberately. */
        isWalkthrough:       !!isWalkthrough,
        status:              resolvedStatus,
        target:              "SCHOOL",
        snapshotGradeSpan:   school.gradeSpan,
      }).returning();

      const scoreRows = scores
        ? Object.entries(scores as Record<string, number>).map(([domainSlug, score]) => ({
            observationId: obs.id,
            domainSlug,
            score: Number(score),
          }))
        : [];
      if (scoreRows.length > 0) await db.insert(observationScores).values(scoreRows);

      const savedScores = await db.select().from(observationScores)
        .where(eq(observationScores.observationId, obs.id));

      /* Derive observer name/email from people */
      const observerMap = await fetchObserverInfo(
        obs.observerEmployeeId ? [obs.observerEmployeeId] : [],
      );
      const observerInfo = obs.observerEmployeeId
        ? observerMap.get(obs.observerEmployeeId)
        : undefined;

      dashboardCache.invalidatePrefix("dashboard:");
      districtCache.invalidatePrefix("district:");
      networkAvgsCache.invalidatePrefix("network-avgs:");

      res.status(201).json({
        id:                 String(obs.id),
        schoolId:           obs.schoolId,
        target:             obs.target,
        date:               obs.date,
        strengths:          obs.strengths ?? undefined,
        growthAreas:        obs.growthAreas ?? undefined,
        observer:           observerInfo?.name ?? "",
        observerEmployeeId: obs.observerEmployeeId ?? undefined,
        observerEmail:      observerInfo?.email ?? undefined,
        status:             obs.status,
        scores:             Object.fromEntries(savedScores.map((s) => [s.domainSlug, s.score])),
      });
      return;
    }

    /* ── TEACHER target ──────────────────────────────────────────── */
    if (!resolvedObservedId || !resolvedRubricSetId || !date) {
      res.status(400).json({ error: "observedEmployeeId, rubricSetId, and date are required" });
      return;
    }
    if (resolvedStatus === "published" && !scores) {
      res.status(400).json({ error: "scores are required for published observations" });
      return;
    }

    /* ── Resolve teacher + school for scope check and frozen snapshots */
    const teacherPerson = await db.query.people.findFirst({ where: eq(people.employeeId, resolvedObservedId) });
    const teacherSchoolId = teacherPerson?.schoolId ?? null;

    const isSchoolScoped = creator.role === "COACH" || creator.role === "SCHOOL_LEADER";
    if (isSchoolScoped) {
      if (!teacherPerson || teacherSchoolId !== creator.schoolId) {
        res.status(403).json({ error: "Cannot create an observation for a person outside your school" });
        return;
      }
    }

    /* Grade span and role snapshot — captured from teacher's current record */
    let snapshotGradeSpanTeacher: string | null = null;
    if (teacherSchoolId) {
      const teacherSchool = await db.query.schools.findFirst({ where: eq(schools.id, teacherSchoolId) });
      snapshotGradeSpanTeacher = teacherSchool?.gradeSpan ?? null;
    }
    const snapshotRoleTeacher: string = teacherPerson?.role ?? "NO_ACCESS";

    if (scores && typeof scores === "object") {
      const scoreValidation = await validateScores(
        scores as Record<string, unknown>,
        Number(resolvedRubricSetId),
      );
      if (!scoreValidation.ok) {
        res.status(400).json({ error: scoreValidation.error });
        return;
      }
    }

    /* ── Action step validation (TEACHER target only) ───────────── */
    const { newActionStep, masterActionStepId, extendActionStep } = req.body as {
      newActionStep?: { text: string; dueDate: string };
      masterActionStepId?: number;
      extendActionStep?: ExtendActionStepInput;
    };

    const extendCheck = validateExtensionRequest(
      extendActionStep, newActionStep !== undefined, new Date().toISOString().split("T")[0]!,
      masterActionStepId !== undefined,
    );
    if (!extendCheck.ok) {
      res.status(400).json({ error: extendCheck.error });
      return;
    }

    let stepToExtend: typeof actionSteps.$inferSelect | null = null;
    if (extendActionStep) {
      stepToExtend = await db.query.actionSteps.findFirst({
        where: eq(actionSteps.id, Number(extendActionStep.actionStepId)),
      }) ?? null;
      const extendable = checkStepIsExtendable(stepToExtend, resolvedObservedId);
      if (!extendable.ok) {
        res.status(400).json({ error: extendable.error });
        return;
      }
    }

    if (newActionStep !== undefined) {
      if (!newActionStep.text || !newActionStep.dueDate) {
        res.status(400).json({ error: "newActionStep requires both text and dueDate" });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newActionStep.dueDate)) {
        res.status(400).json({ error: "newActionStep.dueDate must be a valid ISO date (YYYY-MM-DD)" });
        return;
      }
      const today = new Date().toISOString().split("T")[0]!;
      if (newActionStep.dueDate < today) {
        res.status(400).json({ error: "newActionStep.dueDate must be today or in the future" });
        return;
      }
    }

    let masterStep: typeof actionSteps.$inferSelect | null = null;
    let masteryWarning: string | undefined;
    if (masterActionStepId !== undefined) {
      masterStep = await db.query.actionSteps.findFirst({
        where: eq(actionSteps.id, Number(masterActionStepId)),
      }) ?? null;
      if (!masterStep) {
        res.status(400).json({ error: "masterActionStepId not found" });
        return;
      }
      if (masterStep.teacherEmployeeId !== resolvedObservedId) {
        res.status(400).json({ error: "masterActionStepId does not belong to the observed teacher" });
        return;
      }
      // Only enforce "must be open" when actually publishing — draft autosaves carry
      // masterActionStepId on every tick and must be accepted silently; the step may
      // already be mastered by the time the observation is finally published.
      // Soft-warn path: observation saves normally, mastery write is skipped, and a
      // masteryWarning field is included in the response so the client can inform the user.
      if (resolvedStatus === "published" && masterStep.status !== "open") {
        masteryWarning =
          `Action step "${masterStep.text}" is already ${masterStep.status} — the observation was saved but the mastery flag was not applied.`;
        masterStep = null; // skip mastery write in the transaction below
      }
    }

    /* ── Transactional write: obs + scores + action steps ───────── */
    const { obs, scoreRows } = await db.transaction(async (tx) => {
      const [obs] = await tx.insert(observations).values({
        observedEmployeeId:  resolvedObservedId,
        schoolId:            teacherSchoolId,
        schoolYearId:        activeYearId,
        rubricSetId:         Number(resolvedRubricSetId),
        date,
        time:                time || null,
        course:              course || null,
        strengths:           strengths || null,
        growthAreas:         growthAreas || null,
        observerEmployeeId:  creator.employeeId,
        isWalkthrough:       !!isWalkthrough,
        status:              resolvedStatus,
        target:              "TEACHER",
        snapshotGradeSpan:   snapshotGradeSpanTeacher,
        /* A draft holds its intended action step here rather than creating a
           real one. See the insert below. */
        pendingActionStepText:    resolvedStatus === "draft" ? (newActionStep?.text    ?? null) : null,
        pendingActionStepDueDate: resolvedStatus === "draft" ? (newActionStep?.dueDate ?? null) : null,
      }).returning();

      const scoreRows = scores
        ? Object.entries(scores as Record<string, number>).map(([domainSlug, score]) => ({
            observationId: obs!.id,
            domainSlug,
            score: Number(score),
          }))
        : [];

      if (scoreRows.length > 0) {
        await tx.insert(observationScores).values(scoreRows);
      }

      if (masterStep && resolvedStatus === "published") {
        await tx.update(actionSteps)
          .set({
            status:              "mastered",
            masteredAt:          new Date(),
            masteredByEmployeeId: creator.employeeId,
            masteredDuringObservationId: obs!.id,
          })
          .where(eq(actionSteps.id, masterStep.id));
      }

      if (stepToExtend && extendActionStep) {
        /* Same transaction as the observation: an extension that outlived a
           failed observation would be a date change nobody could explain. */
        await tx.insert(actionStepExtensions).values({
          actionStepId:                stepToExtend.id,
          extendedByEmployeeId:        creator.employeeId,
          extendedDuringObservationId: obs!.id,
          previousDueDate:             stepToExtend.dueDate,
          newDueDate:                  extendActionStep.newDueDate,
          note:                        extendActionStep.note ?? null,
        });
        await tx.update(actionSteps)
          .set({ dueDate: extendActionStep.newDueDate, updatedAt: new Date() })
          .where(eq(actionSteps.id, stepToExtend.id));
      }

      /* Only a published observation assigns an action step.
         A draft used to create one on its first autosave, which put a live
         step on the teacher's list before anybody had decided to give it to
         them — and discarding the draft left the step behind with nothing
         pointing at it. The draft carries it in pendingActionStep* until it is
         published, so there is nothing to orphan. */
      if (newActionStep && resolvedStatus === "published") {
        await tx.insert(actionSteps).values({
          teacherEmployeeId:           resolvedObservedId,
          assignedByEmployeeId:        creator.employeeId,
          assignedDuringObservationId: obs!.id,
          text:                        newActionStep.text,
          dueDate:                     newActionStep.dueDate,
          status:                      "open",
          schoolYearId:                activeYearId,
          snapshotSchoolId:            teacherSchoolId,
          snapshotGradeSpan:           snapshotGradeSpanTeacher,
          snapshotRole:                snapshotRoleTeacher,
        });
      }

      return { obs: obs!, scoreRows };
    });

    /* ── Walkthrough / Rescore queue logic ───────────────────────── */
    if (obs.isWalkthrough && obs.status === "published" && obs.observedEmployeeId) {
      /* Every role's walkthrough counts. This used to exclude COACH, which
         made the rescore queue depend on who happened to do the walkthrough
         rather than on how the teacher scored — and coaches can mark a
         walkthrough from the dashboard and the teacher profile, so their
         below-proficiency walkthroughs simply vanished from the queue.
         Whether a teacher needs rescoring is a fact about the scores. */
      if (scoreRows.length > 0) {
        const avg = scoreRows.reduce((s, r) => s + r.score, 0) / scoreRows.length;
        if (avg < 0.7) {
          /* rescoreFromDate records the walkthrough this deadline was measured
             from, so changing the window later can recalculate it without
             having to work backwards from a date already derived. */
          await db.update(people)
            .set({
              needsRescore:        true,
              rescoreDueDate:      await rescoreDueDateFor(date),
              rescoreFromDate:     date,
              rescoreSchoolYearId: activeYearId,
            })
            .where(eq(people.employeeId, obs.observedEmployeeId));
        } else {
          await db.update(people)
            .set({ needsRescore: false, rescoreDueDate: null, rescoreFromDate: null, rescoreSchoolYearId: null })
            .where(eq(people.employeeId, obs.observedEmployeeId));
        }
      }
    }

    const savedScores = await db.select().from(observationScores)
      .where(eq(observationScores.observationId, obs.id));

    /* Derive observer name/email from people */
    const observerMap = await fetchObserverInfo(
      obs.observerEmployeeId ? [obs.observerEmployeeId] : [],
    );
    const observerInfo = obs.observerEmployeeId
      ? observerMap.get(obs.observerEmployeeId)
      : undefined;

    dashboardCache.invalidatePrefix("dashboard:");
    districtCache.invalidatePrefix("district:");
    networkAvgsCache.invalidatePrefix("network-avgs:");

    res.status(201).json({
      id:                 String(obs.id),
      date:               obs.date,
      time:               obs.time ?? undefined,
      course:             obs.course ?? undefined,
      isWalkthrough:      obs.isWalkthrough,
      strengths:          obs.strengths ?? undefined,
      growthAreas:        obs.growthAreas ?? undefined,
      observer:           observerInfo?.name ?? "",
      observerEmployeeId: obs.observerEmployeeId ?? undefined,
      observerEmail:      observerInfo?.email ?? undefined,
      status:             obs.status,
      scores:             Object.fromEntries(savedScores.map((s) => [s.domainSlug, s.score])),
      ...(masteryWarning !== undefined ? { masteryWarning } : {}),
    });
  } catch (err) {
    console.error("POST /observations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/observations/:id ──────────────────────────────────────
   Draft creators (any role) may edit/publish their own draft.
   Published observations require SCHOOL_LEADER+.                    */
router.put("/:id", observationMutationLimiter, async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const obsId = Number(req.params.id);
    const {
      strengths, growthAreas, scores, status, newActionStep, masterActionStepId, extendActionStep,
      /* Correcting an observation after the fact: which of these were wrong is
         not knowable in advance, so all four are editable. observedEmployeeId
         is constrained to the observation's own school — see below. */
      date: newDate, time: newTime, course: newCourse,
      isWalkthrough: newIsWalkthrough, observedEmployeeId: newObservedId,
      schoolId: newSchoolId,
    } = req.body as {
      strengths?: string;
      growthAreas?: string;
      scores?: Record<string, number>;
      status?: string;
      date?: string;
      time?: string | null;
      course?: string | null;
      isWalkthrough?: boolean;
      observedEmployeeId?: string;
      schoolId?: number;
      newActionStep?: { text: string; dueDate: string };
      masterActionStepId?: number;
      extendActionStep?: ExtendActionStepInput;
    };

    const existing = await db.query.observations.findFirst({
      where: eq(observations.id, obsId),
    });
    if (!existing) { res.status(404).json({ error: "Observation not found" }); return; }

    /* Your own work is yours to correct, whether it is still a draft or was
       filed months ago. A coach who put an observation on the wrong teacher,
       or mistyped the date, used to have to find a school leader to fix it.

       Deliberately not time-limited: an error found late is still an error,
       and the alternative is a wrong record left standing because the window
       shut. Every edit to a filed observation is stamped with who made it and
       when, and shown on the observation, so this is visible rather than
       silent. */
    const isOwnObservation = existing.observerEmployeeId === currentUser.employeeId;

    /* Only an autosave of your own draft skips the audit stamp. Editing your
       own FILED observation is recorded like anybody else's. */
    const isDraftAutosave = existing.status === "draft" && isOwnObservation;

    if (!isOwnObservation) {
      const isSchoolLeader   = currentUser.role === "SCHOOL_LEADER";
      const isNetworkLeader  = currentUser.role === "NETWORK_LEADER";
      const isNetworkAdmin   = currentUser.role === "NETWORK_ADMIN";

      if (!isSchoolLeader && !isNetworkLeader && !isNetworkAdmin) {
        res.status(403).json({ error: "Only School Leaders, Network Leaders, and Network Admins may edit observations" });
        return;
      }

      /* Strict school check using the observation's immutable schoolId.
         Rows with schoolId = null (legacy data), and callers with no school
         assigned, are both denied — see canAccessSchoolScopedRecord.        */
      if (!canAccessSchoolScopedRecord(currentUser, existing.schoolId)) {
        req.log.warn(
          { event: "observation_403_school_mismatch", actingEmployeeId: currentUser.employeeId, targetObsId: obsId, role: currentUser.role, method: req.method },
          "cross-school observation access rejected",
        );
        res.status(403).json({
          error: existing.observedEmployeeId
            ? "Cannot edit observations for people outside your school"
            : "Cannot edit observations for schools outside your school",
        });
        return;
      }
    }

    /* ── Corrected fields, validated BEFORE any write ───────────── */
    if (newDate !== undefined) {
      const d = String(newDate);
      const parsed = new Date(`${d}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(parsed.getTime())
          || parsed.toISOString().slice(0, 10) !== d) {
        res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD." });
        return;
      }
    }

    if (newTime !== undefined && newTime !== null && newTime !== "") {
      if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(String(newTime))) {
        res.status(400).json({ error: "Invalid time format. Use HH:MM or HH:MM:SS (24-hour)." });
        return;
      }
    }

    if (newIsWalkthrough !== undefined && typeof newIsWalkthrough !== "boolean") {
      res.status(400).json({ error: "isWalkthrough must be true or false" });
      return;
    }

    /* Moving a school-wide observation to a different school.
       The counterpart of correcting the wrong teacher: the mistake it exists
       to fix is picking the wrong school from the network list.

       Network roles only, and deliberately stricter than the rest of this
       route. Every other correction leaves the observation where it is; this
       one hands it to a different school, and the school it leaves is the one
       whose leaders could reach it. Somebody who can only see one school
       should not be able to push a record out of it. */
    let movedFromSchoolId: number | null = null;
    if (newSchoolId !== undefined && newSchoolId !== existing.schoolId) {
      if (existing.target !== "SCHOOL") {
        res.status(400).json({ error: "Only a school-wide observation can be moved between schools" });
        return;
      }
      const isNetwork = currentUser.role === "NETWORK_LEADER" || currentUser.role === "NETWORK_ADMIN";
      if (!isNetwork) {
        res.status(403).json({ error: "Only Network Leaders and Network Admins may move an observation to another school" });
        return;
      }
      const nextSchool = await db.query.schools.findFirst({ where: eq(schools.id, Number(newSchoolId)) });
      if (!nextSchool) { res.status(404).json({ error: "School not found" }); return; }
      if (nextSchool.isHomeOffice) {
        res.status(400).json({ error: "The Home Office is not a school to observe" });
        return;
      }
      movedFromSchoolId = existing.schoolId;
    }

    /* Reassigning an observation to a different teacher, within the same
       school only.

       The observation's schoolId is frozen at creation and is what decides who
       may see it; action steps from it carry the same frozen value. Moving one
       across a school boundary would either hide it from both schools or
       require rewriting that history, and the mistake this exists to fix is
       picking the wrong name from one school's list. So the correction is
       allowed and the boundary is not. */
    let reassignedFrom: string | null = null;
    /* Who it moved TO, and their role to re-freeze onto the action steps that
       follow them. Both null when nothing is being reassigned — one variable
       decides whether the move below runs, so it cannot drift from the guards
       that allowed it. */
    let reassignedTo: string | null = null;
    let reassignedToRole: string | null = null;
    if (newObservedId !== undefined && newObservedId !== existing.observedEmployeeId) {
      if (existing.target !== "TEACHER") {
        res.status(400).json({ error: "A school-wide observation has no observed teacher" });
        return;
      }
      const nextTeacher = await db.query.people.findFirst({
        where: eq(people.employeeId, String(newObservedId)),
      });
      if (!nextTeacher) {
        res.status(404).json({ error: "Teacher not found" });
        return;
      }
      if (nextTeacher.schoolId !== existing.schoolId) {
        res.status(400).json({
          error: "An observation can only be reassigned to a teacher at the same school",
        });
        return;
      }
      reassignedFrom   = existing.observedEmployeeId;
      reassignedTo     = String(newObservedId);
      reassignedToRole = nextTeacher.role ?? null;

      /* ── Mastery stops the move ───────────────────────────────────
         Everything this observation did to an action step was written
         against the observed teacher, and checked against them at the time —
         see the three "belongs to a different teacher" guards on this route
         and the create path. Moving the observation to somebody else has to
         take that work along, or leave records contradicting the rule they
         were written under.

         Mastery is where taking it along stops. It is a finished piece of
         one teacher's history, and both ways out are wrong: carrying it over
         credits the new teacher with work they did not do, and quietly
         undoing it erases work the old teacher did. So the move is refused
         and says what to undo first. The person correcting the record
         decides which it was; the server does not guess. */
      const stepsFromThisObs = await db
        .select({ status: actionSteps.status })
        .from(actionSteps)
        .where(eq(actionSteps.assignedDuringObservationId, obsId));
      if (stepsFromThisObs.some((s) => s.status === "mastered")) {
        res.status(400).json({
          error:
            "This observation assigned an action step that has since been marked mastered. "
            + "A mastered step cannot be moved to another teacher. Undo the mastery on the "
            + "teacher's profile first, then reassign the observation.",
        });
        return;
      }

      /* The other direction: a step this observation marked mastered. That
         step was assigned during a different, real visit to the old teacher,
         so it stays with them — but the mastery came from a visit now
         recorded as somebody else's. */
      const [masteredHere] = await db
        .select({ id: actionSteps.id })
        .from(actionSteps)
        .where(eq(actionSteps.masteredDuringObservationId, obsId))
        .limit(1);
      if (masteredHere) {
        res.status(400).json({
          error:
            "This observation marked an action step mastered. That mastery belongs to the "
            + "teacher it was recorded for and cannot be moved. Undo the mastery on their "
            + "profile first, then reassign the observation.",
        });
        return;
      }

      /* Doing both in one request would write the new mastery against the
         teacher being moved away from. Same answer: one at a time. Not
         reachable from the app — no screen sends both — but the route is. */
      if (masterActionStepId !== undefined) {
        res.status(400).json({
          error:
            "An observation cannot be reassigned and mark an action step mastered in the same "
            + "save. Reassign it first, then record the mastery.",
        });
        return;
      }
    }

    /* ── Score validation BEFORE any write ──────────────────────── */
    if (scores && typeof scores === "object") {
      const scoreValidation = await validateScores(
        scores as Record<string, unknown>,
        existing.rubricSetId,
      );
      if (!scoreValidation.ok) {
        res.status(400).json({ error: scoreValidation.error });
        return;
      }
    }

    const resolvedStatus = status === "draft" ? "draft" : status === "published" ? "published" : existing.status;
    const isPublishing = existing.status === "draft" && resolvedStatus === "published";

    /* ── Action step validation (TEACHER target only) ─────────────── */
    if (newActionStep !== undefined && existing.target === "TEACHER") {
      if (!newActionStep.text || !newActionStep.dueDate) {
        res.status(400).json({ error: "newActionStep requires both text and dueDate" });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newActionStep.dueDate)) {
        res.status(400).json({ error: "newActionStep.dueDate must be a valid ISO date (YYYY-MM-DD)" });
        return;
      }
      const today = new Date().toISOString().split("T")[0]!;
      if (newActionStep.dueDate < today) {
        res.status(400).json({ error: "newActionStep.dueDate must be today or in the future" });
        return;
      }
    }

    let masterStepForPut: typeof actionSteps.$inferSelect | null = null;
    let masteryWarning: string | undefined;
    if (masterActionStepId !== undefined && existing.target === "TEACHER") {
      masterStepForPut = await db.query.actionSteps.findFirst({
        where: eq(actionSteps.id, Number(masterActionStepId)),
      }) ?? null;
      if (!masterStepForPut) {
        res.status(400).json({ error: "masterActionStepId not found" });
        return;
      }
      if (masterStepForPut.teacherEmployeeId !== existing.observedEmployeeId) {
        res.status(400).json({ error: "masterActionStepId does not belong to the observed teacher" });
        return;
      }
      // Only enforce "must be open" when actually publishing — draft autosaves carry
      // masterActionStepId on every tick and must be accepted silently; the step may
      // already be mastered by the time the observation is finally published.
      if (resolvedStatus === "published" && masterStepForPut.status !== "open") {
        // Soft-warning path: save the observation but skip the mastery write.
        // This happens when someone else masters the step between the draft save
        // and the final publish.  The observation is saved; only the mastery is skipped.
        masteryWarning =
          "The action step you selected to mark as mastered had already been mastered " +
          "before this observation was published. The observation was saved successfully, " +
          "but the mastery was not recorded again.";
        masterStepForPut = null;
      }
    }

    /* Look up any action step already created for this observation so we can
       upsert rather than insert a duplicate on repeated autosaves.           */
    const extendCheckPut = validateExtensionRequest(
      extendActionStep, newActionStep !== undefined, new Date().toISOString().split("T")[0]!,
      masterActionStepId !== undefined,
    );
    if (!extendCheckPut.ok) {
      res.status(400).json({ error: extendCheckPut.error });
      return;
    }

    let stepToExtendPut: typeof actionSteps.$inferSelect | null = null;
    let priorExtensionForObs: typeof actionStepExtensions.$inferSelect | null = null;
    if (extendActionStep) {
      stepToExtendPut = await db.query.actionSteps.findFirst({
        where: eq(actionSteps.id, Number(extendActionStep.actionStepId)),
      }) ?? null;
      const extendablePut = checkStepIsExtendable(stepToExtendPut, existing.observedEmployeeId);
      if (!extendablePut.ok) {
        res.status(400).json({ error: extendablePut.error });
        return;
      }
      /*
       * Draft autosave calls PUT repeatedly. Without this, every keystroke
       * would add another extension row and push the date again — the same
       * duplication this feature exists to remove, one level down. An
       * extension already made by THIS observation is edited in place.
       */
      priorExtensionForObs = await db.query.actionStepExtensions.findFirst({
        where: and(
          eq(actionStepExtensions.actionStepId, stepToExtendPut!.id),
          eq(actionStepExtensions.extendedDuringObservationId, obsId),
        ),
      }) ?? null;
    }

    let existingStepForObs: typeof actionSteps.$inferSelect | null = null;
    if (newActionStep && existing.target === "TEACHER" && existing.observedEmployeeId) {
      existingStepForObs = await db.query.actionSteps.findFirst({
        where: eq(actionSteps.assignedDuringObservationId, obsId),
      }) ?? null;
    }

    /* ── Active school year + snapshot data for any new action step ── */
    const activeYearRowPut = await db.query.schoolYears.findFirst({
      where: eq(schoolYears.status, "active"),
    });
    const activeYearIdPut = activeYearRowPut?.id ?? null;

    /* A new action step needs a school year to belong to. Without an active
       year the insert below would violate NOT NULL and surface as a 500, so
       reject up front with the same 400 that POST /observations returns.    */
    const willCreateActionStep =
      !!newActionStep && resolvedStatus === "published"
      && existing.target === "TEACHER" && !!existing.observedEmployeeId;
    if (willCreateActionStep && activeYearIdPut === null) {
      res.status(400).json({ error: "No active school year configured" });
      return;
    }

    let snapshotGradeSpanPut: string | null = null;
    let snapshotRolePut: string | null = null;
    if (newActionStep && existing.target === "TEACHER" && existing.observedEmployeeId) {
      const [schoolRowPut, teacherRowPut] = await Promise.all([
        existing.schoolId
          ? db.query.schools.findFirst({ where: eq(schools.id, existing.schoolId) })
          : Promise.resolve(undefined),
        db.query.people.findFirst({ where: eq(people.employeeId, existing.observedEmployeeId) }),
      ]);
      snapshotGradeSpanPut = schoolRowPut?.gradeSpan ?? null;
      snapshotRolePut = teacherRowPut?.role ?? null;
    }

    /* updatedAt is set on edits by non-draft-owner; draft autosaves leave it null */
    const auditFields = !isDraftAutosave
      ? { editedByEmployeeId: currentUser.employeeId, updatedAt: new Date() }
      : {};

    /* ── Transactional write: obs update + scores + action steps ─── */
    const [updated] = await db.transaction(async (tx) => {
      const [updated] = await tx.update(observations)
        .set({
          strengths:   strengths   !== undefined ? (strengths   || null) : existing.strengths,
          growthAreas: growthAreas !== undefined ? (growthAreas || null) : existing.growthAreas,
          status:      resolvedStatus,
          /* Corrections. Each is written only when the caller mentioned it, so
             editing the scores does not quietly blank the course. */
          ...(newDate           !== undefined ? { date:               String(newDate) }        : {}),
          ...(newTime           !== undefined ? { time:               newTime || null }        : {}),
          ...(newCourse         !== undefined ? { course:             newCourse || null }      : {}),
          ...(newIsWalkthrough  !== undefined ? { isWalkthrough:      newIsWalkthrough }       : {}),
          ...(movedFromSchoolId !== null      ? { schoolId:           Number(newSchoolId) }    : {}),
          ...(newObservedId     !== undefined ? { observedEmployeeId: String(newObservedId) }  : {}),
          /* While it is a draft, keep the intended step here so resuming can
             show it. Publishing creates the real step below and clears these,
             so nothing is left claiming a step that now exists for real.
             newActionStep undefined means the caller said nothing about it, so
             whatever is stored stands. */
          ...(resolvedStatus === "draft"
            ? (newActionStep !== undefined
                ? {
                    pendingActionStepText:    newActionStep?.text    ?? null,
                    pendingActionStepDueDate: newActionStep?.dueDate ?? null,
                  }
                : {})
            : { pendingActionStepText: null, pendingActionStepDueDate: null }),
          ...auditFields,
        })
        .where(eq(observations.id, obsId))
        .returning();

      if (scores && typeof scores === "object") {
        await tx.delete(observationScores).where(eq(observationScores.observationId, obsId));
        const scoreRows = Object.entries(scores as Record<string, number>).map(([domainSlug, score]) => ({
          observationId: obsId,
          domainSlug,
          score: Number(score),
        }));
        if (scoreRows.length > 0) await tx.insert(observationScores).values(scoreRows);
      }

      if (masterStepForPut && resolvedStatus === "published") {
        await tx.update(actionSteps)
          .set({
            status:              "mastered",
            masteredAt:          new Date(),
            masteredByEmployeeId: currentUser.employeeId,
            masteredDuringObservationId: obsId,
          })
          .where(eq(actionSteps.id, masterStepForPut.id));
      }

      if (stepToExtendPut && extendActionStep) {
        if (priorExtensionForObs) {
          /* previousDueDate keeps its ORIGINAL value: it records what the date
             was before this observation touched it, not before the last
             autosave. */
          await tx.update(actionStepExtensions)
            .set({
              newDueDate: extendActionStep.newDueDate,
              note:       extendActionStep.note ?? null,
            })
            .where(eq(actionStepExtensions.id, priorExtensionForObs.id));
        } else {
          await tx.insert(actionStepExtensions).values({
            actionStepId:                stepToExtendPut.id,
            extendedByEmployeeId:        currentUser.employeeId,
            extendedDuringObservationId: obsId,
            previousDueDate:             stepToExtendPut.dueDate,
            newDueDate:                  extendActionStep.newDueDate,
            note:                        extendActionStep.note ?? null,
          });
        }
        await tx.update(actionSteps)
          .set({ dueDate: extendActionStep.newDueDate, updatedAt: new Date() })
          .where(eq(actionSteps.id, stepToExtendPut.id));
      }

      /* Same rule as the create path: a draft keeps its intended action step
         on the observation, and only a published one assigns it for real.
         resolvedStatus, not existing.status — this is the request that
         publishes, so the step has to be created in the same write. */
      if (newActionStep && resolvedStatus === "draft") {
        /* Still a draft: hold it, create nothing. */
      } else if (newActionStep && existing.target === "TEACHER" && existing.observedEmployeeId) {
        if (existingStepForObs) {
          /* Upsert: update text/dueDate only if the step is still open.
             If it was already mastered, leave it untouched.              */
          if (existingStepForObs.status === "open") {
            await tx.update(actionSteps)
              .set({ text: newActionStep.text, dueDate: newActionStep.dueDate })
              .where(eq(actionSteps.id, existingStepForObs.id));
          }
        } else {
          await tx.insert(actionSteps).values({
            teacherEmployeeId:           existing.observedEmployeeId,
            assignedByEmployeeId:        currentUser.employeeId,
            assignedDuringObservationId: obsId,
            text:                        newActionStep.text,
            dueDate:                     newActionStep.dueDate,
            status:                      "open",
            /* Non-null guaranteed by the willCreateActionStep guard above */
            schoolYearId:                activeYearIdPut!,
            snapshotSchoolId:            existing.schoolId,
            snapshotGradeSpan:           snapshotGradeSpanPut,
            snapshotRole:                snapshotRolePut,
          });
        }
      }

      /* ── The action steps follow the observation ──────────────────
         An observation put on the wrong teacher assigns its action step to
         the wrong teacher too. Correcting the observation alone left the
         step behind: still open, still counted against somebody who was
         never observed, and still owed by them.

         Last in the transaction on purpose. The insert above writes the
         step against `existing.observedEmployeeId` — the teacher as they
         were before this request — so a save that reassigns AND adds a step
         at once would otherwise leave the new step on the old teacher.
         Sweeping every step tied to this observation at the end catches
         that one as well.

         Mastered steps never reach here: the guard above refuses the whole
         reassignment while one exists.

         The school frozen on the step is left alone deliberately. A
         reassignment cannot cross schools, so snapshotSchoolId and
         snapshotGradeSpan are still true — and they are what school
         scoping reads, so rewriting them is how a step would go missing
         from the school that owns it. The role is the teacher's own, and
         this is a different teacher, so that one is re-frozen. */
      if (reassignedTo !== null) {
        await tx.update(actionSteps)
          .set({
            teacherEmployeeId: reassignedTo,
            ...(reassignedToRole !== null ? { snapshotRole: reassignedToRole } : {}),
            updatedAt: new Date(),
          })
          .where(eq(actionSteps.assignedDuringObservationId, obsId));
      }

      return [updated!];
    });

    /* ── Rescore on publish ──────────────────────────────────────── */
    if (isPublishing && updated.isWalkthrough && updated.observedEmployeeId) {
      /* Same rule as the create path above: the observer's role does not
         decide whether a teacher needs rescoring — the scores do. */
      const savedScoresForRescore = await db.select().from(observationScores)
        .where(eq(observationScores.observationId, obsId));
      if (savedScoresForRescore.length > 0) {
        const avg = savedScoresForRescore.reduce((s, r) => s + r.score, 0) / savedScoresForRescore.length;
        if (avg < 0.7) {
          await db.update(people)
            .set({
              needsRescore:        true,
              rescoreDueDate:      await rescoreDueDateFor(updated.date),
              rescoreFromDate:     updated.date,
              rescoreSchoolYearId: activeYearIdPut,
            })
            .where(eq(people.employeeId, updated.observedEmployeeId));
        } else {
          await db.update(people)
            .set({ needsRescore: false, rescoreDueDate: null, rescoreFromDate: null, rescoreSchoolYearId: null })
            .where(eq(people.employeeId, updated.observedEmployeeId));
        }
      }
    }

    /* ── Rescore after a correction ───────────────────────────────
       An edit can change whether an observation is a walkthrough, when it
       happened, or whose it is. None of those can be answered by looking at
       the observation just written — toggling walkthrough OFF has to remove a
       flag, and reassigning has to settle two people at once — so the queue is
       re-derived from what is on record for each teacher involved.

       Only for published observations that changed something relevant; a draft
       has never contributed to the queue, and editing the wording of a
       published observation should not touch it. */
    const rescoreRelevantChange =
      newIsWalkthrough !== undefined || newDate !== undefined
      || newObservedId !== undefined || scores !== undefined;

    if (resolvedStatus === "published" && rescoreRelevantChange && activeYearIdPut !== null) {
      const affected = new Set<string>();
      if (updated.observedEmployeeId) affected.add(updated.observedEmployeeId);
      /* The teacher it was moved AWAY from: their queue entry may have been
         caused by this very observation, and nothing else would clear it. */
      if (reassignedFrom) affected.add(reassignedFrom);

      for (const employeeId of affected) {
        await recomputeRescoreForTeacher(employeeId, activeYearIdPut);
      }
    }

    const savedScores = await db.select().from(observationScores)
      .where(eq(observationScores.observationId, obsId));

    dashboardCache.invalidatePrefix("dashboard:");
    districtCache.invalidatePrefix("district:");
    networkAvgsCache.invalidatePrefix("network-avgs:");

    let editedByName: string | undefined;
    if (updated.editedByEmployeeId) {
      const editor = await db.query.people.findFirst({ where: eq(people.employeeId, updated.editedByEmployeeId) });
      editedByName = editor ? `${editor.firstName} ${editor.lastName}`.trim() : undefined;
    }

    /* Derive observer name/email from people */
    const observerMap = await fetchObserverInfo(
      updated.observerEmployeeId ? [updated.observerEmployeeId] : [],
    );
    const observerInfo = updated.observerEmployeeId
      ? observerMap.get(updated.observerEmployeeId)
      : undefined;

    res.json({
      id:                 String(updated.id),
      date:               updated.date,
      time:               updated.time ?? undefined,
      course:             updated.course ?? undefined,
      isWalkthrough:      updated.isWalkthrough,
      strengths:          updated.strengths  ?? undefined,
      growthAreas:        updated.growthAreas ?? undefined,
      observer:           observerInfo?.name ?? "",
      observerEmployeeId: updated.observerEmployeeId ?? undefined,
      observerEmail:      observerInfo?.email ?? undefined,
      status:             updated.status,
      editedBy:           editedByName,
      editedAt:           updated.updatedAt?.toISOString() ?? undefined,
      scores:             Object.fromEntries(savedScores.map((s) => [s.domainSlug, s.score])),
      ...(masteryWarning !== undefined ? { masteryWarning } : {}),
    });
  } catch (err) {
    console.error("PUT /observations/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── DELETE /api/observations/:id ───────────────────────────────────
   Draft creators (any role) may delete their own drafts.
   School Leaders: restricted to their own school's people.           */
/* ── What deleting an observation does to its action steps ────────
   An action step used to survive the observation that created it: the link is
   ON DELETE SET NULL, so the step stayed open, stayed assigned, could go
   overdue, and still counted towards a coach's total in the Usage tab, with
   nothing left pointing at where it came from.

   The rule, decided 25 Aug:

     * a step no other observation has touched goes with the observation
     * a step another observation HAS touched survives and moves there, since
       that is a coaching conversation that really happened

   "Touched" means extended or mastered elsewhere. Where both apply the most
   recent extension wins — a step extended in November and mastered in October
   belongs with November, which is where the conversation got to.

   Deleting a step that was mastered is allowed but never quiet: the caller has
   to pass force, and gets told which ones first.                            */
interface StepImpact {
  id:       number;
  text:     string;
  mastered: boolean;
}

async function planActionStepImpact(obsId: number): Promise<{
  toDelete: StepImpact[];
  toMove:   Array<StepImpact & { movingToObservationId: number }>;
}> {
  const steps = await db
    .select({
      id:        actionSteps.id,
      text:      actionSteps.text,
      status:    actionSteps.status,
      masteredDuringObservationId: actionSteps.masteredDuringObservationId,
    })
    .from(actionSteps)
    .where(eq(actionSteps.assignedDuringObservationId, obsId));

  const toDelete: StepImpact[] = [];
  const toMove: Array<StepImpact & { movingToObservationId: number }> = [];

  for (const step of steps) {
    const [latestExtension] = await db
      .select({ observationId: actionStepExtensions.extendedDuringObservationId })
      .from(actionStepExtensions)
      .where(and(
        eq(actionStepExtensions.actionStepId, step.id),
        isNotNull(actionStepExtensions.extendedDuringObservationId),
        ne(actionStepExtensions.extendedDuringObservationId, obsId),
      ))
      .orderBy(desc(actionStepExtensions.createdAt), desc(actionStepExtensions.id))
      .limit(1);

    const masteredElsewhere =
      step.masteredDuringObservationId !== null && step.masteredDuringObservationId !== obsId
        ? step.masteredDuringObservationId
        : null;

    const newHome = latestExtension?.observationId ?? masteredElsewhere;
    const summary: StepImpact = {
      id: step.id, text: step.text, mastered: step.status === "mastered",
    };

    if (newHome !== null && newHome !== undefined) {
      toMove.push({ ...summary, movingToObservationId: newHome });
    } else {
      toDelete.push(summary);
    }
  }

  return { toDelete, toMove };
}

/* ── GET /api/observations/:id/delete-impact ──────────────────────
   What deleting this observation would do to its action steps, asked before
   anything is shown to the person.

   The 409 on DELETE says the same thing, but only after a round trip that
   looks to the caller like a failed delete — an older cached bundle reports
   it as one. Asking first means the confirmation can state the consequence in
   one dialog instead of a second one appearing after the first is accepted. */
router.get("/:id/delete-impact", async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const obsId = Number(req.params.id);
    if (!Number.isFinite(obsId)) {
      res.status(400).json({ error: "Invalid observation id" }); return;
    }

    const existing = await db.query.observations.findFirst({
      where: eq(observations.id, obsId),
    });
    if (!existing) { res.status(404).json({ error: "Observation not found" }); return; }

    /* Same access rule as the delete itself: asking what would happen must not
       reveal anything about an observation you could not delete. */
    const isOwnObservation = existing.observerEmployeeId === currentUser.employeeId;
    if (!isOwnObservation) {
      const mayDelete = currentUser.role === "SCHOOL_LEADER"
        || currentUser.role === "NETWORK_LEADER"
        || currentUser.role === "NETWORK_ADMIN";
      if (!mayDelete || !canAccessSchoolScopedRecord(currentUser, existing.schoolId)) {
        res.status(403).json({ error: "Not permitted to delete this observation" }); return;
      }
    }

    const impact = await planActionStepImpact(obsId);
    res.json({ stepsToDelete: impact.toDelete, stepsToMove: impact.toMove });
  } catch (err) {
    console.error("GET /observations/:id/delete-impact error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", observationMutationLimiter, async (req, res) => {
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

    /* Same rule as editing: your own observation is yours to remove, filed or
       not. The action-step warning below still applies in full — it names what
       would go with it, mastered steps included, and refuses without an
       explicit force. A coach sees that warning exactly as a school leader
       does. */
    const isOwnObservation = existing.observerEmployeeId === currentUser.employeeId;

    if (!isOwnObservation) {
      const isSchoolLeader  = currentUser.role === "SCHOOL_LEADER";
      const isNetworkLeader = currentUser.role === "NETWORK_LEADER";
      const isNetworkAdmin  = currentUser.role === "NETWORK_ADMIN";

      if (!isSchoolLeader && !isNetworkLeader && !isNetworkAdmin) {
        res.status(403).json({ error: "Only School Leaders, Network Leaders, and Network Admins may delete observations" });
        return;
      }

      /* Strict school check using the observation's immutable schoolId.
         Rows with schoolId = null (legacy data), and callers with no school
         assigned, are both denied — see canAccessSchoolScopedRecord.        */
      if (!canAccessSchoolScopedRecord(currentUser, existing.schoolId)) {
        req.log.warn(
          { event: "observation_403_school_mismatch", actingEmployeeId: currentUser.employeeId, targetObsId: obsId, role: currentUser.role, method: req.method },
          "cross-school observation access rejected",
        );
        res.status(403).json({
          error: existing.observedEmployeeId
            ? "Cannot delete observations for people outside your school"
            : "Cannot delete observations for schools outside your school",
        });
        return;
      }
    }

    /* Same shape as the rubric-set, category and domain deletes: refuse with
       409 and say what would be lost, unless the caller passes ?force=true. */
    const impact = await planActionStepImpact(obsId);
    const force  = req.query.force === "true";

    if (impact.toDelete.length > 0 && !force) {
      res.status(409).json({
        error: "This observation has action steps that would be deleted with it",
        code:  "ACTION_STEPS_WOULD_BE_DELETED",
        stepsToDelete: impact.toDelete,
        stepsToMove:   impact.toMove,
      });
      return;
    }

    await db.transaction(async (tx) => {
      for (const step of impact.toMove) {
        /* Survives, and moves to the observation that last touched it. */
        await tx.update(actionSteps)
          .set({ assignedDuringObservationId: step.movingToObservationId })
          .where(eq(actionSteps.id, step.id));
      }
      if (impact.toDelete.length > 0) {
        await tx.delete(actionSteps)
          .where(inArray(actionSteps.id, impact.toDelete.map((x) => x.id)));
      }
      await tx.delete(observations).where(eq(observations.id, obsId));
    });

    dashboardCache.invalidatePrefix("dashboard:");
    districtCache.invalidatePrefix("district:");
    networkAvgsCache.invalidatePrefix("network-avgs:");

    res.json({
      ok: true,
      id: String(obsId),
      deletedActionSteps: impact.toDelete.length,
      movedActionSteps:   impact.toMove.length,
    });
  } catch (err) {
    console.error("DELETE /observations/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
