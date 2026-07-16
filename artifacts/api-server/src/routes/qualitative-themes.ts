import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db } from "@workspace/db";
import {
  observations,
  people,
  schools,
  rubricSets,
  actionSteps,
  qualitativeThemesCache,
} from "@workspace/db/schema";
import { eq, and, inArray, sql, count } from "drizzle-orm";
import {
  effectiveSchoolId as resolveSchoolId,
  NoSchoolAssignedError,
  assertNetworkSchoolAccess,
} from "../middleware/auth";
import { generateQualitativeThemesSummary } from "../services/ai-service";

const router = Router();

/* ── Per-user rate limiter for the expensive AI generation endpoint ──
   10 requests per 15-minute window per authenticated user.
   Uses employeeId as the key so limits are per account, not per IP.  */
const qualitativeGenerationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => {
    const user = req.user as Express.User | undefined;
    return user?.employeeId ?? ipKeyGenerator(req.ip ?? "");
  },
  handler: (req, res) => {
    req.log.warn(
      {
        event:            "qualitative_generation_rate_limit_exceeded",
        actingEmployeeId: (req.user as Express.User | undefined)?.employeeId,
        path:             req.path,
      },
      "qualitative themes generation rate limit exceeded",
    );
    res.status(429).json({ error: "Too many AI requests. Please wait a moment before trying again." });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

/* ── Shared helper: get teacher employee IDs for a school ─────── */
async function getTeacherIdsForSchool(schoolId: number): Promise<string[]> {
  const rows = await db
    .select({ employeeId: people.employeeId })
    .from(people)
    .where(and(eq(people.schoolId, schoolId), eq(people.isActive, true)));
  return rows.map((r) => r.employeeId).filter((id): id is string => id !== null);
}

/* ── GET /api/qualitative-themes
   Returns cached result + current obs count for staleness badge. ── */
router.get("/", async (req, res) => {
  try {
    const user        = req.user as Express.User;
    const rawSchoolId = req.query.schoolId ? Number(req.query.schoolId) : null;
    const rubricSlug  = typeof req.query.rubricSlug === "string" ? req.query.rubricSlug : undefined;

    if (!rubricSlug) return res.status(400).json({ error: "rubricSlug required" });

    let resolvedId: number | null;
    try {
      resolvedId = await resolveSchoolId(user, rawSchoolId);
    } catch (e) {
      if (e instanceof NoSchoolAssignedError) return res.status(400).json({ error: (e as Error).message });
      throw e;
    }
    if (resolvedId == null) return res.status(400).json({ error: "No school resolved for this user." });
    let scopedSchoolId: number = resolvedId;

    if (rawSchoolId && rawSchoolId !== scopedSchoolId) {
      await assertNetworkSchoolAccess(user, rawSchoolId);
      scopedSchoolId = rawSchoolId;
    }

    const [rubricSet] = await db.select().from(rubricSets).where(eq(rubricSets.slug, rubricSlug)).limit(1);
    if (!rubricSet) return res.status(404).json({ error: "Rubric not found" });

    /* ── Count via teacher IDs so null school_id on obs is not a blocker ── */
    const teacherIds = await getTeacherIdsForSchool(scopedSchoolId);

    let obsCount = 0;
    if (teacherIds.length > 0) {
      const [row] = await db
        .select({ obsCount: count() })
        .from(observations)
        .where(and(
          inArray(observations.observedEmployeeId, teacherIds),
          eq(observations.rubricSetId, rubricSet.id),
          eq(observations.status, "published"),
          eq(observations.target, "TEACHER"),
        ));
      obsCount = row?.obsCount ?? 0;
    }

    const [cached] = await db
      .select()
      .from(qualitativeThemesCache)
      .where(and(
        eq(qualitativeThemesCache.schoolId, scopedSchoolId),
        eq(qualitativeThemesCache.rubricSlug, rubricSlug),
      ))
      .limit(1);

    return res.json({
      cache: cached
        ? {
            result:               cached.result,
            generatedAt:          cached.generatedAt.toISOString(),
            obsCountAtGeneration: cached.obsCountAtGeneration,
          }
        : null,
      currentObsCount: obsCount,
    });
  } catch (err) {
    console.error("GET /qualitative-themes error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/qualitative-themes/generate ─────────────────────────────────
   Generates and caches a qualitative themes summary for the school.
   Observations are found via the teacher roster (people.schoolId) rather than
   the nullable school_id column on the observation row itself. ── */
router.post("/generate", qualitativeGenerationLimiter, async (req, res) => {
  try {
    const user        = req.user as Express.User;
    const rawSchoolId = req.body.schoolId ? Number(req.body.schoolId) : null;
    const rubricSlug  = typeof req.body.rubricSlug === "string" ? req.body.rubricSlug : undefined;

    if (!rubricSlug) return res.status(400).json({ error: "rubricSlug required" });

    let resolvedId2: number | null;
    try {
      resolvedId2 = await resolveSchoolId(user, rawSchoolId);
    } catch (e) {
      if (e instanceof NoSchoolAssignedError) return res.status(400).json({ error: (e as Error).message });
      throw e;
    }
    if (resolvedId2 == null) return res.status(400).json({ error: "No school resolved for this user." });
    let scopedSchoolId: number = resolvedId2;

    if (rawSchoolId && rawSchoolId !== scopedSchoolId) {
      await assertNetworkSchoolAccess(user, rawSchoolId);
      scopedSchoolId = rawSchoolId;
    }

    const [rubricSet] = await db.select().from(rubricSets).where(eq(rubricSets.slug, rubricSlug)).limit(1);
    if (!rubricSet) return res.status(404).json({ error: "Rubric not found" });

    const [school] = await db.select().from(schools).where(eq(schools.id, scopedSchoolId)).limit(1);
    if (!school) return res.status(404).json({ error: "School not found" });

    /* ── Get teacher roster for this school ─────────────────────── */
    const teacherIds = await getTeacherIdsForSchool(scopedSchoolId);
    if (teacherIds.length === 0) {
      return res.status(400).json({ error: "No active teachers found for this school." });
    }

    /* ── Fetch published teacher observations via teacher roster ── */
    const obsRows = await db
      .select({
        id:                 observations.id,
        observedEmployeeId: observations.observedEmployeeId,
        date:               observations.date,
        strengths:          observations.strengths,
        growthAreas:        observations.growthAreas,
        teacherName:        sql<string>`${people.firstName} || ' ' || ${people.lastName}`,
        teacherLastName:    people.lastName,
      })
      .from(observations)
      .leftJoin(people, eq(people.employeeId, observations.observedEmployeeId))
      .where(and(
        inArray(observations.observedEmployeeId, teacherIds),
        eq(observations.rubricSetId, rubricSet.id),
        eq(observations.status, "published"),
        eq(observations.target, "TEACHER"),
      ))
      .orderBy(observations.date);

    /* ── Build employee ID → last name lookup ── */
    const teacherIdToLastName: Record<string, string> = {};
    for (const row of obsRows) {
      if (row.observedEmployeeId && row.teacherLastName) {
        teacherIdToLastName[row.observedEmployeeId] = row.teacherLastName;
      }
    }

    if (obsRows.length === 0) {
      return res.status(400).json({ error: "No published observations found for this school and rubric period." });
    }

    /* ── Fetch action steps for the observed teachers ── */
    const observedIds = [...new Set(
      obsRows.map((o) => o.observedEmployeeId).filter((id): id is string => id !== null),
    )];

    const today    = new Date().toISOString().split("T")[0]!;
    const allSteps = observedIds.length > 0
      ? await db.select({
          teacherEmployeeId: actionSteps.teacherEmployeeId,
          text:              actionSteps.text,
          status:            actionSteps.status,
          dueDate:           actionSteps.dueDate,
        })
        .from(actionSteps)
        .where(inArray(actionSteps.teacherEmployeeId, observedIds))
      : [];

    /* ── Server-side action step counts ── */
    let openCount = 0, overdueCount = 0, resolvedCount = 0;
    for (const s of allSteps) {
      if (s.status === "mastered") {
        resolvedCount++;
      } else if (s.dueDate && s.dueDate < today) {
        overdueCount++;
      } else {
        openCount++;
      }
    }

    /* ── Build AI context block ── */
    const obsBlock = obsRows.map((obs) => [
      `[Obs #${obs.id} | Teacher: ${obs.teacherName ?? "Unknown"} (${obs.observedEmployeeId ?? "??"}) | Date: ${obs.date}]`,
      `STRENGTHS: ${obs.strengths?.trim() || "(none recorded)"}`,
      `GROWTH AREAS: ${obs.growthAreas?.trim() || "(none recorded)"}`,
    ].join("\n")).join("\n\n");

    const stepsBlock = allSteps.length > 0
      ? allSteps.map((s) => {
          const status = s.status === "mastered" ? "resolved" : s.dueDate && s.dueDate < today ? "overdue" : "open";
          return `- ${s.teacherEmployeeId} | ${status} | "${s.text}"`;
        }).join("\n")
      : "(no action steps found)";

    const prompt = `SCHOOL: ${school.displayName} (ID: ${scopedSchoolId})
RUBRIC PERIOD: ${rubricSlug} — ${rubricSet.name}
TOTAL OBSERVATIONS: ${obsRows.length}

IMPORTANT: This report is based EXCLUSIVELY on the written qualitative comments in STRENGTHS and GROWTH AREAS fields — the narrative feedback written by observers. Do NOT reference or infer from numerical scores. Your analysis must come directly from the text of the comments below.

OBSERVATIONS (qualitative comments only — STRENGTHS and GROWTH AREAS written by observers):
${obsBlock}

ACTION STEPS (for reference when identifying grows that lack follow-up):
${stepsBlock}

---

TASK: Identify recurring qualitative themes from the STRENGTHS and GROWTH AREAS comment text above.
A theme is "recurring" only if similar language or concepts appear in observations from at least 2 DIFFERENT teachers.
Base every theme directly on specific language from the comment text — do not invent or infer from scores.

Return ONLY a valid JSON object (no markdown fences, no explanation):
{
  "recurringGlows": [
    {
      "theme": "Concise 1-2 sentence description of the shared strength, drawn from comment language",
      "teacherCount": <integer>,
      "observationCount": <integer>,
      "teacherIds": ["<exact employeeId>", ...],
      "observationIds": [<exact integer obs id>, ...]
    }
  ],
  "recurringGrows": [
    {
      "theme": "Concise 1-2 sentence description of the shared growth area, drawn from comment language",
      "teacherCount": <integer>,
      "observationCount": <integer>,
      "teacherIds": ["<exact employeeId>", ...],
      "observationIds": [<exact integer obs id>, ...]
    }
  ],
  "growsWithNoActionStep": ["exact theme label from recurringGrows", ...]
}

Rules:
- Only include themes that appear across 2+ DIFFERENT teachers
- Base themes on the written comment text, not on numerical scores
- teacherIds must be exact employeeId strings from the data above
- observationIds must be exact numeric IDs from the data above
- growsWithNoActionStep: copy the "theme" label from recurringGrows entries that have no corresponding action step addressing them
- Return [] for any section with no qualifying themes`;

    /* ── Call AI ── */
    const rawResponse = await generateQualitativeThemesSummary(prompt);

    /* ── Parse JSON (strip markdown fences if model adds them) ── */
    let parsed: {
      recurringGlows:        { theme: string; teacherCount: number; observationCount: number; teacherIds: string[]; observationIds: number[] }[];
      recurringGrows:        { theme: string; teacherCount: number; observationCount: number; teacherIds: string[]; observationIds: number[] }[];
      growsWithNoActionStep: string[];
    };

    try {
      const clean = rawResponse.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      console.error("Failed to parse AI qualitative themes response:", rawResponse);
      return res.status(502).json({ error: "AI returned an invalid response. Please try again." });
    }

    /* ── Enrich each theme with teacher last names ── */
    function enrichThemes(
      themes: { theme: string; teacherCount: number; observationCount: number; teacherIds: string[]; observationIds: number[] }[],
    ) {
      return themes.map((t) => ({
        ...t,
        teacherNames: t.teacherIds.map((id) => teacherIdToLastName[id] ?? id),
      }));
    }

    /* ── Merge into final result ── */
    const result = {
      schoolName:     school.displayName,
      recurringGlows: enrichThemes(parsed.recurringGlows ?? []),
      recurringGrows: enrichThemes(parsed.recurringGrows ?? []),
      actionStepFollowThrough: {
        open:                  openCount,
        overdue:               overdueCount,
        resolved:              resolvedCount,
        growsWithNoActionStep: parsed.growsWithNoActionStep ?? [],
      },
    };

    /* ── Upsert cache ── */
    await db.insert(qualitativeThemesCache)
      .values({
        schoolId:             scopedSchoolId,
        rubricSlug,
        result,
        generatedAt:          new Date(),
        obsCountAtGeneration: obsRows.length,
      })
      .onConflictDoUpdate({
        target: [qualitativeThemesCache.schoolId, qualitativeThemesCache.rubricSlug],
        set: {
          result,
          generatedAt:          new Date(),
          obsCountAtGeneration: obsRows.length,
        },
      });

    return res.json(result);
  } catch (err) {
    console.error("POST /qualitative-themes/generate error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
