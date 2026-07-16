import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db } from "@workspace/db";
import { dashboardCache } from "./dashboard";
import { districtCache }  from "./district";
import { networkAvgsCache } from "./action-center";
import {
  observations, observationScores, people, rubricSets, schools,
  rubricCategories, rubricDomains, observationScoreValueSchema,
  actionSteps,
} from "@workspace/db/schema";
import { eq, desc, and, ne, inArray } from "drizzle-orm";

const router = Router();

/* ── Per-user rate limiter for mutation endpoints ────────────────────
   Limits PUT and DELETE to 30 requests per 15-minute window per user
   (or IP when unauthenticated). Blunts brute-force ID enumeration.    */
const observationMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
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

/* ── GET /api/observations/my-latest-rubric ─────────────────────────
   Returns the slug of the rubric set containing the current user's
   most recent PUBLISHED observation (by date). Returns { slug: null }
   if the user has no published observations recorded.                 */
router.get("/my-latest-rubric", async (req, res) => {
  const currentUser = req.user as Express.User;
  const latest = await db
    .select({ slug: rubricSets.slug })
    .from(observations)
    .innerJoin(rubricSets, eq(rubricSets.id, observations.rubricSetId))
    .where(and(eq(observations.observerEmployeeId, currentUser.employeeId), ne(observations.status, "draft")))
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

    const drafts = await db
      .select({
        id:                  observations.id,
        observedEmployeeId:  observations.observedEmployeeId,
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
        observer:            observations.observer,
        status:              observations.status,
      })
      .from(observations)
      .leftJoin(people,     eq(people.employeeId, observations.observedEmployeeId))
      .innerJoin(rubricSets, eq(rubricSets.id,    observations.rubricSetId))
      .where(and(
        eq(observations.observerEmployeeId, currentUser.employeeId),
        eq(observations.status, "draft"),
        eq(observations.target, "TEACHER"),
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

    res.json(drafts.map((d) => ({
      id:                String(d.id),
      observedEmployeeId: d.observedEmployeeId ?? undefined,
      teacherName:       d.personFirst
        ? [d.personFirst, d.personLast].filter(Boolean).join(" ") || undefined
        : undefined,
      rubricSetId:   d.rubricSetId,
      rubricSetSlug: d.rubricSetSlug,
      rubricSetName: d.rubricSetName,
      date:          d.date,
      time:          d.time ?? undefined,
      course:        d.course ?? undefined,
      isWalkthrough: d.isWalkthrough,
      strengths:     d.strengths ?? undefined,
      growthAreas:   d.growthAreas ?? undefined,
      observer:      d.observer,
      status:        d.status,
      scores:        scoresByObs.get(d.id) ?? {},
    })));
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

    const conditions = [eq(observations.target, "SCHOOL")];
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

    res.json(rows.map((o) => ({
      id:                 String(o.id),
      schoolId:           o.schoolId,
      target:             o.target,
      date:               o.date,
      strengths:          o.strengths ?? undefined,
      growthAreas:        o.growthAreas ?? undefined,
      observer:           o.observer,
      observerEmployeeId: o.observerEmployeeId ?? undefined,
      observerEmail:      o.observerEmail ?? undefined,
      status:             o.status,
      scores:             scoresByObs.get(o.id) ?? {},
    })));
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

    if (currentUser.role === "SCHOOL_LEADER" || currentUser.role === "COACH") {
      if (existing.target === "SCHOOL") {
        if (existing.schoolId !== currentUser.schoolId) {
          res.status(403).json({ error: "Cannot access observations for schools outside your school" });
          return;
        }
      } else {
        /* Strict school check using the observation's immutable schoolId.
           Rows with schoolId = null (legacy data) are denied to school-scoped
           users (fail-closed) — they cannot be attributed to any particular
           school and may originate from a prior placement.                  */
        if (existing.schoolId !== currentUser.schoolId) {
          res.status(403).json({ error: "Cannot access observations for people outside your school" });
          return;
        }
      }
    }

    const savedScores = await db.select().from(observationScores)
      .where(eq(observationScores.observationId, obsId));

    res.json({
      id:                 String(existing.id),
      date:               existing.date,
      time:               existing.time ?? undefined,
      course:             existing.course ?? undefined,
      isWalkthrough:      existing.isWalkthrough,
      strengths:          existing.strengths ?? undefined,
      growthAreas:        existing.growthAreas ?? undefined,
      observer:           existing.observer,
      observerEmployeeId: existing.observerEmployeeId ?? undefined,
      observerEmail:      existing.observerEmail ?? undefined,
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
           observer?, scores, isWalkthrough?, status?, target?,
           schoolId? }
   For target=SCHOOL: schoolId required, observedEmployeeId ignored,
   caller must be NETWORK_ADMIN.
   observerEmployeeId is ALWAYS derived from the authenticated session. */
router.post("/", async (req, res) => {
  try {
    const {
      observedEmployeeId, teacherId,
      rubricSetId, quarterId, date, time, course, strengths, growthAreas,
      observer, scores, isWalkthrough, status, target, schoolId,
    } = req.body;

    /* Legacy support: teacherId (old field) falls back to observedEmployeeId */
    const resolvedObservedId: string | undefined = observedEmployeeId ?? teacherId;
    const resolvedRubricSetId = rubricSetId ?? quarterId;
    const resolvedStatus: string = status === "draft" ? "draft" : "published";
    const resolvedTarget: "TEACHER" | "SCHOOL" = target === "SCHOOL" ? "SCHOOL" : "TEACHER";

    const creator = req.user as Express.User;

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
        rubricSetId:         Number(resolvedRubricSetId),
        date,
        time:                time || null,
        course:              course || null,
        strengths:           strengths || null,
        growthAreas:         growthAreas || null,
        observer:            observer || creator.name,
        observerEmployeeId:  creator.employeeId,
        observerEmail:       creator.email,
        isWalkthrough:       false,
        status:              resolvedStatus,
        target:              "SCHOOL",
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
        observer:           obs.observer,
        observerEmployeeId: obs.observerEmployeeId ?? undefined,
        observerEmail:      obs.observerEmail ?? undefined,
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

    /* ── School-scope enforcement on create ─────────────────────── */
    const isSchoolScoped = creator.role === "COACH" || creator.role === "SCHOOL_LEADER";
    if (isSchoolScoped) {
      const target = await db.query.people.findFirst({ where: eq(people.employeeId, resolvedObservedId) });
      if (!target || target.schoolId !== creator.schoolId) {
        res.status(403).json({ error: "Cannot create an observation for a person outside your school" });
        return;
      }
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

    /* ── Action step validation (TEACHER target only) ───────────── */
    const { newActionStep, masterActionStepId } = req.body as {
      newActionStep?: { text: string; dueDate: string };
      masterActionStepId?: number;
    };

    if (newActionStep !== undefined) {
      if (!newActionStep.text || !newActionStep.dueDate) {
        res.status(400).json({ error: "newActionStep requires both text and dueDate" });
        return;
      }
      const today = new Date().toISOString().split("T")[0]!;
      if (newActionStep.dueDate < today) {
        res.status(400).json({ error: "newActionStep.dueDate must be today or in the future" });
        return;
      }
    }

    let masterStep: typeof actionSteps.$inferSelect | null = null;
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
      if (masterStep.status !== "open") {
        res.status(400).json({ error: "masterActionStepId is not currently open" });
        return;
      }
    }

    /* ── Transactional write: obs + scores + action steps ───────── */
    const { obs, scoreRows } = await db.transaction(async (tx) => {
      const [obs] = await tx.insert(observations).values({
        observedEmployeeId:  resolvedObservedId,
        schoolId:            creator.schoolId ?? null,
        rubricSetId:         Number(resolvedRubricSetId),
        date,
        time:                time || null,
        course:              course || null,
        strengths:           strengths || null,
        growthAreas:         growthAreas || null,
        observer:            observer || creator.name,
        observerEmployeeId:  creator.employeeId,
        observerEmail:       creator.email,
        isWalkthrough:       !!isWalkthrough,
        status:              resolvedStatus,
        target:              "TEACHER",
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

      if (masterStep) {
        await tx.update(actionSteps)
          .set({
            status:              "mastered",
            masteredAt:          new Date(),
            masteredByEmployeeId: creator.employeeId,
            masteredDuringObservationId: obs!.id,
          })
          .where(eq(actionSteps.id, masterStep.id));
      }

      if (newActionStep) {
        await tx.insert(actionSteps).values({
          teacherEmployeeId:           resolvedObservedId,
          assignedByEmployeeId:        creator.employeeId,
          assignedDuringObservationId: obs!.id,
          text:                        newActionStep.text,
          dueDate:                     newActionStep.dueDate,
          status:                      "open",
        });
      }

      return { obs: obs!, scoreRows };
    });

    /* ── Walkthrough / Rescore queue logic ───────────────────────── */
    if (obs.isWalkthrough && obs.status === "published" && obs.observedEmployeeId) {
      const canTriggerRescore =
        creator.role === "NETWORK_ADMIN" ||
        creator.role === "NETWORK_LEADER" ||
        creator.role === "SCHOOL_LEADER";

      if (canTriggerRescore && scoreRows.length > 0) {
        const avg = scoreRows.reduce((s, r) => s + r.score, 0) / scoreRows.length;
        if (avg < 0.7) {
          const due = new Date(date);
          due.setDate(due.getDate() + 14);
          await db.update(people)
            .set({ needsRescore: true, rescoreDueDate: due.toISOString().split("T")[0] })
            .where(eq(people.employeeId, obs.observedEmployeeId));
        } else {
          await db.update(people)
            .set({ needsRescore: false, rescoreDueDate: null })
            .where(eq(people.employeeId, obs.observedEmployeeId));
        }
      }
    }

    const savedScores = await db.select().from(observationScores)
      .where(eq(observationScores.observationId, obs.id));

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
      observer:           obs.observer,
      observerEmployeeId: obs.observerEmployeeId ?? undefined,
      observerEmail:      obs.observerEmail ?? undefined,
      status:             obs.status,
      scores:             Object.fromEntries(savedScores.map((s) => [s.domainSlug, s.score])),
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
    const { strengths, growthAreas, observer, scores, status, newActionStep, masterActionStepId } = req.body as {
      strengths?: string;
      growthAreas?: string;
      observer?: string;
      scores?: Record<string, number>;
      status?: string;
      newActionStep?: { text: string; dueDate: string };
      masterActionStepId?: number;
    };

    const existing = await db.query.observations.findFirst({
      where: eq(observations.id, obsId),
    });
    if (!existing) { res.status(404).json({ error: "Observation not found" }); return; }

    const isDraftEdit = existing.status === "draft" && existing.observerEmployeeId === currentUser.employeeId;

    if (!isDraftEdit) {
      const isSchoolLeader   = currentUser.role === "SCHOOL_LEADER";
      const isNetworkLeader  = currentUser.role === "NETWORK_LEADER";
      const isNetworkAdmin   = currentUser.role === "NETWORK_ADMIN";

      if (!isSchoolLeader && !isNetworkLeader && !isNetworkAdmin) {
        res.status(403).json({ error: "Only School Leaders, Network Leaders, and Network Admins may edit observations" });
        return;
      }

      if (currentUser.role === "SCHOOL_LEADER") {
        if (existing.observedEmployeeId) {
          /* Strict school check using the observation's immutable schoolId.
             Rows with schoolId = null (legacy data) are denied to school-
             scoped users (fail-closed) — cannot be attributed to a school. */
          if (existing.schoolId !== currentUser.schoolId) {
            req.log.warn(
              { event: "observation_403_school_mismatch", actingEmployeeId: currentUser.employeeId, targetObsId: obsId, role: currentUser.role, method: req.method },
              "cross-school observation access rejected",
            );
            res.status(403).json({ error: "Cannot edit observations for people outside your school" });
            return;
          }
        } else {
          if (existing.schoolId !== currentUser.schoolId) {
            req.log.warn(
              { event: "observation_403_school_mismatch", actingEmployeeId: currentUser.employeeId, targetObsId: obsId, role: currentUser.role, method: req.method },
              "cross-school observation access rejected",
            );
            res.status(403).json({ error: "Cannot edit observations for schools outside your school" });
            return;
          }
        }
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

    /* ── Action step validation (TEACHER target only) ─────────────── */
    if (newActionStep !== undefined && existing.target === "TEACHER") {
      if (!newActionStep.text || !newActionStep.dueDate) {
        res.status(400).json({ error: "newActionStep requires both text and dueDate" });
        return;
      }
      const today = new Date().toISOString().split("T")[0]!;
      if (newActionStep.dueDate < today) {
        res.status(400).json({ error: "newActionStep.dueDate must be today or in the future" });
        return;
      }
    }

    let masterStepForPut: typeof actionSteps.$inferSelect | null = null;
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
      if (masterStepForPut.status !== "open") {
        res.status(400).json({ error: "masterActionStepId is not currently open" });
        return;
      }
    }

    /* Look up any action step already created for this observation so we can
       upsert rather than insert a duplicate on repeated autosaves.           */
    let existingStepForObs: typeof actionSteps.$inferSelect | null = null;
    if (newActionStep && existing.target === "TEACHER" && existing.observedEmployeeId) {
      existingStepForObs = await db.query.actionSteps.findFirst({
        where: eq(actionSteps.assignedDuringObservationId, obsId),
      }) ?? null;
    }

    const resolvedStatus = status === "draft" ? "draft" : status === "published" ? "published" : existing.status;
    const isPublishing = existing.status === "draft" && resolvedStatus === "published";

    const auditFields = !isDraftEdit
      ? { editedByEmployeeId: currentUser.employeeId, editedAt: new Date() }
      : {};

    /* ── Transactional write: obs update + scores + action steps ─── */
    const [updated] = await db.transaction(async (tx) => {
      const [updated] = await tx.update(observations)
        .set({
          strengths:   strengths   !== undefined ? (strengths   || null) : existing.strengths,
          growthAreas: growthAreas !== undefined ? (growthAreas || null) : existing.growthAreas,
          observer:    observer    !== undefined ? (observer    || existing.observer) : existing.observer,
          status:      resolvedStatus,
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

      if (masterStepForPut) {
        await tx.update(actionSteps)
          .set({
            status:              "mastered",
            masteredAt:          new Date(),
            masteredByEmployeeId: currentUser.employeeId,
            masteredDuringObservationId: obsId,
          })
          .where(eq(actionSteps.id, masterStepForPut.id));
      }

      if (newActionStep && existing.target === "TEACHER" && existing.observedEmployeeId) {
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
          });
        }
      }

      return [updated!];
    });

    /* ── Rescore on publish ──────────────────────────────────────── */
    if (isPublishing && updated.isWalkthrough && updated.observedEmployeeId) {
      const canTriggerRescore =
        currentUser.role === "NETWORK_ADMIN" ||
        currentUser.role === "NETWORK_LEADER" ||
        currentUser.role === "SCHOOL_LEADER";

      if (canTriggerRescore) {
        const savedScoresForRescore = await db.select().from(observationScores)
          .where(eq(observationScores.observationId, obsId));
        if (savedScoresForRescore.length > 0) {
          const avg = savedScoresForRescore.reduce((s, r) => s + r.score, 0) / savedScoresForRescore.length;
          if (avg < 0.7) {
            const due = new Date(updated.date);
            due.setDate(due.getDate() + 14);
            await db.update(people)
              .set({ needsRescore: true, rescoreDueDate: due.toISOString().split("T")[0] })
              .where(eq(people.employeeId, updated.observedEmployeeId));
          } else {
            await db.update(people)
              .set({ needsRescore: false, rescoreDueDate: null })
              .where(eq(people.employeeId, updated.observedEmployeeId));
          }
        }
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

    res.json({
      id:                 String(updated.id),
      date:               updated.date,
      time:               updated.time ?? undefined,
      course:             updated.course ?? undefined,
      isWalkthrough:      updated.isWalkthrough,
      strengths:          updated.strengths  ?? undefined,
      growthAreas:        updated.growthAreas ?? undefined,
      observer:           updated.observer,
      observerEmployeeId: updated.observerEmployeeId ?? undefined,
      observerEmail:      updated.observerEmail ?? undefined,
      status:             updated.status,
      editedBy:           editedByName,
      editedAt:           updated.editedAt?.toISOString() ?? undefined,
      scores:             Object.fromEntries(savedScores.map((s) => [s.domainSlug, s.score])),
    });
  } catch (err) {
    console.error("PUT /observations/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── DELETE /api/observations/:id ───────────────────────────────────
   Draft creators (any role) may delete their own drafts.
   School Leaders: restricted to their own school's people.           */
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

    const isDraftOwner = existing.status === "draft" && existing.observerEmployeeId === currentUser.employeeId;

    if (!isDraftOwner) {
      const isSchoolLeader  = currentUser.role === "SCHOOL_LEADER";
      const isNetworkLeader = currentUser.role === "NETWORK_LEADER";
      const isNetworkAdmin  = currentUser.role === "NETWORK_ADMIN";

      if (!isSchoolLeader && !isNetworkLeader && !isNetworkAdmin) {
        res.status(403).json({ error: "Only School Leaders, Network Leaders, and Network Admins may delete observations" });
        return;
      }

      if (currentUser.role === "SCHOOL_LEADER") {
        if (existing.observedEmployeeId) {
          /* Strict school check using the observation's immutable schoolId.
             Rows with schoolId = null (legacy data) are denied to school-
             scoped users (fail-closed) — cannot be attributed to a school. */
          if (existing.schoolId !== currentUser.schoolId) {
            req.log.warn(
              { event: "observation_403_school_mismatch", actingEmployeeId: currentUser.employeeId, targetObsId: obsId, role: currentUser.role, method: req.method },
              "cross-school observation access rejected",
            );
            res.status(403).json({ error: "Cannot delete observations for people outside your school" });
            return;
          }
        } else {
          if (existing.schoolId !== currentUser.schoolId) {
            req.log.warn(
              { event: "observation_403_school_mismatch", actingEmployeeId: currentUser.employeeId, targetObsId: obsId, role: currentUser.role, method: req.method },
              "cross-school observation access rejected",
            );
            res.status(403).json({ error: "Cannot delete observations for schools outside your school" });
            return;
          }
        }
      }
    }

    await db.delete(observations).where(eq(observations.id, obsId));

    dashboardCache.invalidatePrefix("dashboard:");
    districtCache.invalidatePrefix("district:");
    networkAvgsCache.invalidatePrefix("network-avgs:");

    res.json({ ok: true, id: String(obsId) });
  } catch (err) {
    console.error("DELETE /observations/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
