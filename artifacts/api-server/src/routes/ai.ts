import { Router } from "express";
import { db } from "@workspace/db";
import {
  observations,
  observationScores,
  actionSteps,
  people,
  schools,
  rubricDomains,
  rubricSets,
  chatSessions,
  chatMessages,
} from "@workspace/db/schema";
import { eq, and, inArray, sql, desc, or, isNull } from "drizzle-orm";
import {
  generateAIResponseRaw,
  generateAIResponseStreamRaw,
  generateAnalysisSummary,
  generateStructuredInstantAnalysis,
  buildContextBlock,
  buildQualitativeSection,
  type AIContext,
  type CalibrationFlag,
  type DomainAvg,
  type GlowGrowEntry,
  type ActionStepEntry,
  type TeacherQualitativeData,
} from "../services/ai-service";
import { effectiveSchoolId as resolveSchoolId, NoSchoolAssignedError, assertNetworkSchoolAccess } from "../middleware/auth";
import { isProduction } from "../config/env";

const router = Router();

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

function weeksBetween(a: string, b: string): number {
  const msPerWeek = 1000 * 60 * 60 * 24 * 7;
  return Math.round(Math.abs(new Date(b).getTime() - new Date(a).getTime()) / msPerWeek);
}

async function getRubricSetId(slug: string): Promise<number | null> {
  const rows = await db.select({ id: rubricSets.id }).from(rubricSets).where(eq(rubricSets.slug, slug)).limit(1);
  return rows[0]?.id ?? null;
}

async function getPersonIds(scopedSchoolId: number | null): Promise<string[]> {
  const baseConditions = [
    eq(people.isActive, true),
    eq(people.includeInFeedbackTracker, true),
  ];
  const rows = scopedSchoolId === null
    ? await db.select({ employeeId: people.employeeId }).from(people).where(and(...baseConditions as [ReturnType<typeof eq>, ReturnType<typeof eq>]))
    : await db.select({ employeeId: people.employeeId }).from(people).where(and(
        ...baseConditions as [ReturnType<typeof eq>, ReturnType<typeof eq>],
        eq(people.schoolId, scopedSchoolId),
      ));
  return rows.map((r) => r.employeeId);
}

async function slugNameMap(slugs: string[]): Promise<Map<string, string>> {
  if (!slugs.length) return new Map();
  const rows = await db
    .select({ slug: rubricDomains.slug, name: rubricDomains.name })
    .from(rubricDomains)
    .where(inArray(rubricDomains.slug, slugs));
  const m = new Map<string, string>();
  for (const r of rows) {
    if (!m.has(r.slug)) m.set(r.slug, r.name);
  }
  return m;
}

async function buildDomainAverages(personIds: string[], rubricSetId?: number | null): Promise<DomainAvg[]> {
  if (!personIds.length) return [];

  const whereClause = rubricSetId != null
    ? and(inArray(observations.observedEmployeeId, personIds), eq(observations.rubricSetId, rubricSetId))
    : inArray(observations.observedEmployeeId, personIds);

  const rows = await db
    .select({
      domainSlug: observationScores.domainSlug,
      score:      observationScores.score,
    })
    .from(observationScores)
    .innerJoin(observations, eq(observations.id, observationScores.observationId))
    .where(whereClause);

  const byDomain = new Map<string, number[]>();
  for (const r of rows) {
    const bucket = byDomain.get(r.domainSlug) ?? [];
    bucket.push(r.score);
    byDomain.set(r.domainSlug, bucket);
  }

  const names = await slugNameMap(Array.from(byDomain.keys()));

  return Array.from(byDomain.entries()).map(([domainSlug, scores]) => ({
    domainSlug,
    domainName: names.get(domainSlug) ?? domainSlug,
    avg:        scores.reduce((s, v) => s + v, 0) / scores.length,
    count:      scores.length,
  }));
}

async function buildCalibrationFlags(
  personIds: string[],
  scope: "school" | "network",
  rubricSetId?: number | null,
): Promise<CalibrationFlag[]> {
  if (!personIds.length) return [];

  const whereClause = rubricSetId != null
    ? and(inArray(observations.observedEmployeeId, personIds), eq(observations.rubricSetId, rubricSetId))
    : inArray(observations.observedEmployeeId, personIds);

  const rows = await db
    .select({
      observedEmployeeId: observations.observedEmployeeId,
      observerEmployeeId: observations.observerEmployeeId,
      observerFirst:      people.firstName,
      observerLast:       people.lastName,
      isWalkthrough:      observations.isWalkthrough,
      domainSlug:         observationScores.domainSlug,
      score:              observationScores.score,
    })
    .from(observationScores)
    .innerJoin(observations, eq(observations.id, observationScores.observationId))
    .leftJoin(people, eq(people.employeeId, observations.observerEmployeeId))
    .where(whereClause);

  if (!rows.length) return [];

  type TeacherDomainKey = string;
  const tdMap = new Map<TeacherDomainKey, {
    domain: string;
    coachScores: number[];
    networkScores: number[];
    observerScores: Map<string, { name: string; scores: number[] }>;
  }>();

  for (const r of rows) {
    if (!r.observedEmployeeId) continue;
    const key: TeacherDomainKey = `${r.observedEmployeeId}|${r.domainSlug}`;
    const entry = tdMap.get(key) ?? {
      domain:         r.domainSlug,
      coachScores:    [] as number[],
      networkScores:  [] as number[],
      observerScores: new Map<string, { name: string; scores: number[] }>(),
    };

    if (r.isWalkthrough) {
      entry.networkScores.push(r.score);
    } else {
      entry.coachScores.push(r.score);
      if (r.observerEmployeeId) {
        const obsEntry = entry.observerScores.get(r.observerEmployeeId) ?? {
          name:   r.observerFirst ? `${r.observerFirst} ${r.observerLast ?? ""}`.trim() : `Observer ${r.observerEmployeeId}`,
          scores: [],
        };
        obsEntry.scores.push(r.score);
        entry.observerScores.set(r.observerEmployeeId, obsEntry);
      }
    }

    tdMap.set(key, entry);
  }

  type ObsDomainKey = string;
  const flagMap = new Map<ObsDomainKey, {
    observerName: string;
    domain:       string;
    coachScores:  number[];
    networkScores: number[];
  }>();

  for (const entry of tdMap.values()) {
    if (!entry.coachScores.length || !entry.networkScores.length) continue;
    const coachAvg   = entry.coachScores.reduce((s, v) => s + v, 0) / entry.coachScores.length;
    const networkAvg = entry.networkScores.reduce((s, v) => s + v, 0) / entry.networkScores.length;
    if (Math.abs(coachAvg - networkAvg) < 0.5) continue;

    for (const [observerId, obs] of entry.observerScores) {
      const key: ObsDomainKey = `${observerId}|${entry.domain}`;
      const flagEntry = flagMap.get(key) ?? {
        observerName:  obs.name,
        domain:        entry.domain,
        coachScores:   [],
        networkScores: [],
      };
      flagEntry.coachScores.push(...obs.scores);
      flagEntry.networkScores.push(networkAvg);
      flagMap.set(key, flagEntry);
    }
  }

  const allSlugs = Array.from(new Set(rows.map((r) => r.domainSlug)));
  const names = await slugNameMap(allSlugs);

  const flags: CalibrationFlag[] = [];
  for (const entry of flagMap.values()) {
    const coachAvg   = entry.coachScores.reduce((s, v) => s + v, 0) / entry.coachScores.length;
    const networkAvg = entry.networkScores.reduce((s, v) => s + v, 0) / entry.networkScores.length;
    const delta      = Math.abs(coachAvg - networkAvg);
    if (delta >= 0.5) {
      flags.push({
        teacher:      entry.observerName,
        domain:       names.get(entry.domain) ?? entry.domain,
        schoolScore:  coachAvg,
        networkScore: networkAvg,
        delta,
      });
    }
  }
  return flags.sort((a, b) => b.delta - a.delta);
}

/* ── GET /api/ai/chats ──────────────────────────────────────────── */
router.get("/chats", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const sessions = await db
      .select({
        id:        chatSessions.id,
        title:     chatSessions.title,
        createdAt: chatSessions.createdAt,
        updatedAt: chatSessions.updatedAt,
      })
      .from(chatSessions)
      .where(eq(chatSessions.employeeId, user.employeeId))
      .orderBy(desc(chatSessions.updatedAt));
    res.json(sessions);
  } catch (err) {
    console.error("GET /ai/chats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/ai/chats ─────────────────────────────────────────── */
router.post("/chats", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const { firstMessage } = req.body as { firstMessage?: string };

    let title = "New Chat";
    if (firstMessage?.trim()) {
      const raw = firstMessage.trim().slice(0, 60);
      title = raw.charAt(0).toUpperCase() + raw.slice(1);
      if (firstMessage.trim().length > 60) title += "…";
    }

    const [session] = await db
      .insert(chatSessions)
      .values({ employeeId: user.employeeId, title })
      .returning();
    res.status(201).json(session);
  } catch (err) {
    console.error("POST /ai/chats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/ai/chats/:id/messages ─────────────────────────────── */
router.get("/chats/:id/messages", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [session] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, id), eq(chatSessions.employeeId, user.employeeId)))
      .limit(1);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }

    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, id))
      .orderBy(chatMessages.createdAt);
    res.json(messages);
  } catch (err) {
    console.error("GET /ai/chats/:id/messages error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PATCH /api/ai/chats/:id ────────────────────────────────────── */
router.patch("/chats/:id", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { title } = req.body as { title?: string };
    if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }

    const [updated] = await db
      .update(chatSessions)
      .set({ title: title.trim(), updatedAt: new Date() })
      .where(and(eq(chatSessions.id, id), eq(chatSessions.employeeId, user.employeeId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("PATCH /ai/chats/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── DELETE /api/ai/chats/:id ───────────────────────────────────── */
router.delete("/chats/:id", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const deleted = await db
      .delete(chatSessions)
      .where(and(eq(chatSessions.id, id), eq(chatSessions.employeeId, user.employeeId)))
      .returning({ id: chatSessions.id });
    if (!deleted.length) { res.status(404).json({ error: "Not found" }); return; }
    res.status(204).end();
  } catch (err) {
    console.error("DELETE /ai/chats/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Helper: fetch full people list for the current scope ─────────── */
async function getScopedPeople(
  scopedSchoolId: number | null,
): Promise<Array<{ employeeId: string; firstName: string; lastName: string }>> {
  const baseConditions = [
    eq(people.isActive, true),
    eq(people.includeInFeedbackTracker, true),
  ];
  const rows = scopedSchoolId === null
    ? await db
        .select({ employeeId: people.employeeId, firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .where(and(...baseConditions as [ReturnType<typeof eq>, ReturnType<typeof eq>]))
    : await db
        .select({ employeeId: people.employeeId, firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .where(and(
          ...baseConditions as [ReturnType<typeof eq>, ReturnType<typeof eq>],
          eq(people.schoolId, scopedSchoolId),
        ));
  return rows;
}

/* ── Helper: detect which teachers from the pool are mentioned in a message ── */
function findMentionedTeachers(
  messageText: string,
  teacherPool: Array<{ employeeId: string; firstName: string; lastName: string }>,
): Array<{ employeeId: string; name: string }> {
  const lower = messageText.toLowerCase();
  const matched: Array<{ employeeId: string; name: string }> = [];
  for (const p of teacherPool) {
    const lastName  = p.lastName.toLowerCase();
    const fullName  = `${p.firstName} ${p.lastName}`.toLowerCase();
    if (lower.includes(lastName) || lower.includes(fullName)) {
      matched.push({ employeeId: p.employeeId, name: `${p.firstName} ${p.lastName}` });
    }
  }
  return matched;
}

/* ── Helper: detect relative teacher references ("my lowest," "top 3," etc.) ── */
const RELATIVE_BOTTOM_KEYWORDS = [
  "lowest", "weakest", "worst", "struggling", "behind", "underperform",
  "least proficient", "needs support", "needs work", "poorest", "bottom",
];
const RELATIVE_TOP_KEYWORDS = [
  "highest", "strongest", "best", "top performer", "leading", "excel",
  "star", "outstanding", "most proficient", "top teacher",
];

/* ── Helper: detect "which teacher(s)" / "who has" intent ─────────────────── */
const TEACHER_DATA_INTENT_KEYWORDS = [
  "which teacher", "which of my teacher", "which staff",
  "who has", "who have", "who scored", "who is below", "who are below",
  "who is above", "who are above", "who needs", "who need",
  "pulling down", "dragging down",
  "name the teacher", "identify the teacher", "list the teacher",
  "per teacher", "by teacher", "teacher breakdown", "individual teacher",
  "each teacher", "every teacher",
];

function detectTeacherDataIntent(messageText: string): boolean {
  const lower = messageText.toLowerCase();
  return TEACHER_DATA_INTENT_KEYWORDS.some((kw) => lower.includes(kw));
}

function detectRelativeReference(
  messageText: string,
): { kind: "bottom" | "top" | null; n: number } {
  const lower = messageText.toLowerCase();

  /* Try to pull an explicit count, e.g. "lowest 3" or "top 5 teachers" */
  const countMatch = lower.match(/\b(?:top|bottom|lowest|highest|weakest|strongest|worst|best)\s+(\d+)\b/);
  const n = countMatch ? Math.min(parseInt(countMatch[1]!, 10), 10) : 3;

  const isBottom = RELATIVE_BOTTOM_KEYWORDS.some((kw) => lower.includes(kw));
  const isTop    = RELATIVE_TOP_KEYWORDS.some((kw) => lower.includes(kw));

  if (isBottom) return { kind: "bottom", n };
  if (isTop)    return { kind: "top",    n };
  return { kind: null, n: 3 };
}

/* ── Helper: build a ranked teacher list by overall average score ──────────── */
async function buildRankedTeacherSection(
  teacherPool: Array<{ employeeId: string; firstName: string; lastName: string }>,
  allRubricSets: Array<{ id: number; slug: string; name: string }>,
  rubricSetId: number | null,
  kind: "bottom" | "top",
  n: number,
): Promise<string> {
  if (!teacherPool.length) return "";

  const empIds = teacherPool.map((t) => t.employeeId);

  const whereClause = rubricSetId != null
    ? and(inArray(observations.observedEmployeeId, empIds), eq(observations.rubricSetId, rubricSetId))
    : inArray(observations.observedEmployeeId, empIds);

  const rows = await db
    .select({
      observedEmployeeId: observations.observedEmployeeId,
      score:              observationScores.score,
    })
    .from(observationScores)
    .innerJoin(observations, eq(observations.id, observationScores.observationId))
    .where(whereClause);

  if (!rows.length) return "";

  /* Compute per-teacher averages */
  const teacherScores = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.observedEmployeeId) continue;
    const bucket = teacherScores.get(r.observedEmployeeId) ?? [];
    bucket.push(r.score);
    teacherScores.set(r.observedEmployeeId, bucket);
  }

  const nameMap = new Map(teacherPool.map((t) => [t.employeeId, `${t.firstName} ${t.lastName}`]));

  type TeacherRank = { name: string; avg: number; count: number };
  const ranked: TeacherRank[] = [];
  for (const [empId, scores] of teacherScores) {
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    ranked.push({ name: nameMap.get(empId) ?? empId, avg, count: scores.length });
  }

  ranked.sort((a, b) => kind === "bottom" ? a.avg - b.avg : b.avg - a.avg);
  const selected = ranked.slice(0, n);

  const label    = kind === "bottom" ? "Lowest-scoring" : "Highest-scoring";
  const rsLabel  = rubricSetId != null
    ? (allRubricSets.find((r) => r.id === rubricSetId)?.name ?? "")
    : "";
  const header   = rsLabel
    ? `## ${label} teachers — ${rsLabel} (ranked by overall average)\n`
    : `## ${label} teachers (ranked by overall average)\n`;

  const lines: string[] = [header];
  selected.forEach((t, i) => {
    const status = t.avg >= 0.7 ? "✓ proficient" : "⚠ below threshold";
    lines.push(`${i + 1}. ${t.name}: avg ${t.avg.toFixed(3)} across ${t.count} score(s) [${status}]`);
  });
  lines.push("");

  return lines.join("\n");
}

/* ── Helper: build per-teacher cross-period domain scores section ──── */
async function buildTeacherBreakdowns(
  matchedTeachers: Array<{ employeeId: string; name: string }>,
  allRubricSets: Array<{ id: number; slug: string; name: string }>,
): Promise<string> {
  if (!matchedTeachers.length) return "";

  const empIds = matchedTeachers.map((t) => t.employeeId);

  const rows = await db
    .select({
      observedEmployeeId: observations.observedEmployeeId,
      rubricSetId:        observations.rubricSetId,
      domainSlug:         observationScores.domainSlug,
      score:              observationScores.score,
    })
    .from(observationScores)
    .innerJoin(observations, eq(observations.id, observationScores.observationId))
    .where(inArray(observations.observedEmployeeId, empIds));

  if (!rows.length) return "";

  const allSlugs = Array.from(new Set(rows.map((r) => r.domainSlug)));
  const domainNameMap = await slugNameMap(allSlugs);

  /* Group: employeeId -> rubricSetId -> domainSlug -> scores[] */
  const grouped = new Map<string, Map<number, Map<string, number[]>>>();
  for (const r of rows) {
    if (!r.observedEmployeeId) continue;
    let byRS = grouped.get(r.observedEmployeeId);
    if (!byRS) { byRS = new Map(); grouped.set(r.observedEmployeeId, byRS); }
    let byDomain = byRS.get(r.rubricSetId);
    if (!byDomain) { byDomain = new Map(); byRS.set(r.rubricSetId, byDomain); }
    const bucket = byDomain.get(r.domainSlug) ?? [];
    bucket.push(r.score);
    byDomain.set(r.domainSlug, bucket);
  }

  const rsMap = new Map(allRubricSets.map((rs) => [rs.id, rs]));
  const lines: string[] = ["## Individual teacher breakdown by rubric period\n"];

  for (const teacher of matchedTeachers) {
    lines.push(`### ${teacher.name}`);
    const byRS = grouped.get(teacher.employeeId);
    if (!byRS || !byRS.size) {
      lines.push("No observation data on record.\n");
      continue;
    }
    for (const [rsId, byDomain] of byRS) {
      const rs = rsMap.get(rsId);
      const rsLabel = rs?.name ?? `Rubric set ${rsId}`;
      lines.push(`\n**${rsLabel}**`);
      for (const [domainSlug, scores] of byDomain) {
        const domainName = domainNameMap.get(domainSlug) ?? domainSlug;
        const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
        const status = avg >= 0.7 ? "✓ proficient" : "⚠ below threshold";
        lines.push(`- ${domainName}: ${avg.toFixed(3)} (${scores.length} observation(s)) [${status}]`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/* ── Helper: fetch glows & grows per teacher (published obs only, last 5) ── */
async function buildGlowsGrowsData(
  personIds: string[],
  scopedSchoolId: number | null,
): Promise<Map<string, GlowGrowEntry[]>> {
  if (!personIds.length) return new Map();

  /*
   * School-scope guard: when scopedSchoolId is set we only include observations
   * that were explicitly recorded at that school (observations.schoolId = scopedSchoolId)
   * OR that carry no school tag at all (null — backward-compat for old rows).
   * This prevents a teacher who transferred from School B to School A from
   * leaking their School-B coaching notes into School A's AI context.
   */
  const schoolFilter = scopedSchoolId !== null
    ? or(isNull(observations.schoolId), eq(observations.schoolId, scopedSchoolId))
    : undefined;

  const rows = await db
    .select({
      observedEmployeeId: observations.observedEmployeeId,
      date:               observations.date,
      strengths:          observations.strengths,
      growthAreas:        observations.growthAreas,
    })
    .from(observations)
    .where(
      and(
        inArray(observations.observedEmployeeId, personIds),
        eq(observations.status, "published"),
        schoolFilter,
      ),
    )
    .orderBy(desc(observations.date));

  /* Group by teacher, cap at 5 most-recent per teacher with any text */
  const result = new Map<string, GlowGrowEntry[]>();
  for (const r of rows) {
    if (!r.observedEmployeeId) continue;
    if (!r.strengths && !r.growthAreas) continue;
    const bucket = result.get(r.observedEmployeeId) ?? [];
    if (bucket.length >= 5) continue;
    bucket.push({ date: r.date, strengths: r.strengths, growthAreas: r.growthAreas });
    result.set(r.observedEmployeeId, bucket);
  }
  return result;
}

/* ── Helper: fetch action steps per teacher (school-scoped via personIds) ── */
async function buildActionStepsData(
  personIds: string[],
  scopedSchoolId: number | null,
): Promise<Map<string, ActionStepEntry[]>> {
  if (!personIds.length) return new Map();

  /*
   * School-scope guard: when scopedSchoolId is set we LEFT JOIN to the
   * assignedDuringObservationId observation and only include rows where:
   *   (a) the action step has no linked observation (assignedDuringObservationId IS NULL)
   *   (b) the linked observation has no school tag (backward-compat for old rows)
   *   (c) the linked observation was recorded at the current school
   *
   * This prevents a teacher who transferred from School B to School A from
   * leaking their School-B action steps into School A's AI context.
   *
   * personIds is always derived from getScopedPeople(), which already filters
   * by people.schoolId — this adds a second layer of school isolation.
   */
  const query = db
    .select({
      teacherEmployeeId: actionSteps.teacherEmployeeId,
      text:              actionSteps.text,
      dueDate:           actionSteps.dueDate,
      status:            actionSteps.status,
      masteredAt:        actionSteps.masteredAt,
      createdAt:         actionSteps.createdAt,
    })
    .from(actionSteps)
    .leftJoin(observations, eq(observations.id, actionSteps.assignedDuringObservationId));

  const rows = await query
    .where(
      scopedSchoolId !== null
        ? and(
            inArray(actionSteps.teacherEmployeeId, personIds),
            or(
              isNull(actionSteps.assignedDuringObservationId),
              isNull(observations.schoolId),
              eq(observations.schoolId, scopedSchoolId),
            ),
          )
        : inArray(actionSteps.teacherEmployeeId, personIds),
    )
    .orderBy(actionSteps.createdAt);

  const result = new Map<string, ActionStepEntry[]>();
  for (const r of rows) {
    const bucket = result.get(r.teacherEmployeeId) ?? [];
    bucket.push({
      text:       r.text,
      dueDate:    r.dueDate,
      status:     r.status,
      masteredAt: r.masteredAt,
      createdAt:  r.createdAt,
    });
    result.set(r.teacherEmployeeId, bucket);
  }
  return result;
}

/* ── Helper: build combined context string for one or multiple rubric sets ── */
async function buildCombinedContext(
  personIds: string[],
  scopedPeople: Array<{ employeeId: string; firstName: string; lastName: string }>,
  scope: "school" | "network",
  scopedSchoolId: number | null,
  rescoreQueueCount: number,
  totalObservations: number,
  allRubricSets: Array<{ id: number; slug: string; name: string }>,
  activeSlug: string | null,
  messageText: string,
): Promise<{ contextStr: string; activeRubricSetSlug: string | null; matchedTeachers: string[] }> {
  /* Determine which rubric slugs are relevant to this message */
  const mentionedSlugs = new Set<string>();
  if (activeSlug) mentionedSlugs.add(activeSlug);

  /* Detect additional rubric sets mentioned by slug or name in the message */
  const msgLower = messageText.toLowerCase();
  for (const rs of allRubricSets) {
    if (msgLower.includes(rs.slug.toLowerCase()) || msgLower.includes(rs.name.toLowerCase())) {
      mentionedSlugs.add(rs.slug);
    }
  }

  /* Detect teacher name mentions and relative references ("my weakest", "top 3", …) */
  const matchedTeachers   = findMentionedTeachers(messageText, scopedPeople);
  const relativeRef       = detectRelativeReference(messageText);
  const teacherDataIntent = detectTeacherDataIntent(messageText);

  /* If only one rubric is relevant (or none), build a single context block */
  const slugList = Array.from(mentionedSlugs);

  let contextStr: string;

  if (slugList.length <= 1) {
    const singleSlug = slugList[0] ?? null;
    const rsRow = singleSlug ? allRubricSets.find((r) => r.slug === singleSlug) : null;
    const rsId   = rsRow?.id ?? null;

    const [domainAverages, calibrationFlags] = await Promise.all([
      buildDomainAverages(personIds, rsId),
      buildCalibrationFlags(personIds, scope, rsId),
    ]);

    const ctx: AIContext = {
      scope,
      rubricSetName:     rsRow?.name,
      domainAverages,
      totalTeachers:     personIds.length,
      totalObservations,
      rescoreQueueCount,
      calibrationFlags,
    };
    contextStr = buildContextBlock(ctx);

    /* Always inject full per-teacher breakdown — the AI needs teacher-level
       data regardless of how the question is phrased. */
    const allAsMatched = scopedPeople.map((p) => ({
      employeeId: p.employeeId,
      name: `${p.firstName} ${p.lastName}`,
    }));
    const [teacherSection, glowsGrowsMap, actionStepsMap] = await Promise.all([
      buildTeacherBreakdowns(allAsMatched, allRubricSets),
      buildGlowsGrowsData(personIds, scopedSchoolId),
      buildActionStepsData(personIds, scopedSchoolId),
    ]);
    if (teacherSection) contextStr += "\n\n" + teacherSection;

    /* Ranked list for explicit "weakest / top N" queries */
    if (relativeRef.kind) {
      const rankedSection = await buildRankedTeacherSection(
        scopedPeople, allRubricSets, rsId, relativeRef.kind, relativeRef.n,
      );
      if (rankedSection) contextStr += "\n\n" + rankedSection;
    }

    /* Qualitative coaching data (glows/grows + action steps) */
    const qualTeachers: TeacherQualitativeData[] = scopedPeople.map((p) => ({
      teacherName: `${p.firstName} ${p.lastName}`,
      glowsGrows:  glowsGrowsMap.get(p.employeeId) ?? [],
      actionSteps: actionStepsMap.get(p.employeeId) ?? [],
    }));
    const qualSection = buildQualitativeSection(qualTeachers);
    if (qualSection) contextStr += "\n\n" + qualSection;

    return { contextStr, activeRubricSetSlug: singleSlug, matchedTeachers: matchedTeachers.map((t) => t.name) };
  }

  /* Multiple rubric sets referenced — build a section per rubric */
  const blocks: string[] = [
    `## Cross-rubric comparison (scope: ${scope}, teachers: ${personIds.length}, total observations: ${totalObservations})\n`,
  ];

  for (const slug of slugList) {
    const rsRow = allRubricSets.find((r) => r.slug === slug);
    if (!rsRow) continue;
    const [domainAverages, calibrationFlags] = await Promise.all([
      buildDomainAverages(personIds, rsRow.id),
      buildCalibrationFlags(personIds, scope, rsRow.id),
    ]);
    const ctx: AIContext = {
      scope,
      rubricSetName:     rsRow.name,
      domainAverages,
      totalTeachers:     personIds.length,
      totalObservations,
      rescoreQueueCount,
      calibrationFlags,
    };
    blocks.push(buildContextBlock(ctx));
  }

  /* Always inject full per-teacher breakdown for all teachers in scope */
  const allAsMatchedMulti = scopedPeople.map((p) => ({
    employeeId: p.employeeId,
    name: `${p.firstName} ${p.lastName}`,
  }));
  const [teacherSectionMulti, glowsGrowsMapMulti, actionStepsMapMulti] = await Promise.all([
    buildTeacherBreakdowns(allAsMatchedMulti, allRubricSets),
    buildGlowsGrowsData(personIds, scopedSchoolId),
    buildActionStepsData(personIds, scopedSchoolId),
  ]);
  if (teacherSectionMulti) blocks.push(teacherSectionMulti);

  /* Ranked list for explicit "weakest / top N" queries */
  if (relativeRef.kind) {
    const rankedSection = await buildRankedTeacherSection(
      scopedPeople, allRubricSets, null, relativeRef.kind, relativeRef.n,
    );
    if (rankedSection) blocks.push(rankedSection);
  }

  /* Qualitative coaching data (glows/grows + action steps) */
  const qualTeachersMulti: TeacherQualitativeData[] = scopedPeople.map((p) => ({
    teacherName: `${p.firstName} ${p.lastName}`,
    glowsGrows:  glowsGrowsMapMulti.get(p.employeeId) ?? [],
    actionSteps: actionStepsMapMulti.get(p.employeeId) ?? [],
  }));
  const qualSectionMulti = buildQualitativeSection(qualTeachersMulti);
  if (qualSectionMulti) blocks.push(qualSectionMulti);

  return { contextStr: blocks.join("\n\n"), activeRubricSetSlug: activeSlug, matchedTeachers: matchedTeachers.map((t) => t.name) };
}

/* ── POST /api/ai/chat/stream ───────────────────────────────────── */
router.post("/chat/stream", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const { message, schoolId: reqSchoolId, sessionId, rubricSetSlug } = req.body as {
      message?: string;
      schoolId?: number | null;
      sessionId?: number | null;
      rubricSetSlug?: string;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: "message is required" }); return;
    }

    if (reqSchoolId != null) {
      const access = await assertNetworkSchoolAccess(user, reqSchoolId);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    }

    if (sessionId != null) {
      const [sess] = await db
        .select({ id: chatSessions.id })
        .from(chatSessions)
        .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.employeeId, user.employeeId)))
        .limit(1);
      if (!sess) { res.status(403).json({ error: "Session not found" }); return; }
    }

    const scopedSchoolId = resolveSchoolId(user, reqSchoolId ?? null);
    const scope: "school" | "network" = scopedSchoolId !== null ? "school" : "network";
    const [scopedPeople, allRubricSets] = await Promise.all([
      getScopedPeople(scopedSchoolId),
      db.select({ id: rubricSets.id, slug: rubricSets.slug, name: rubricSets.name }).from(rubricSets),
    ]);
    const personIds = scopedPeople.map((p) => p.employeeId);

    const [rescoreRows, obsCountResult] = await Promise.all([
      personIds.length
        ? db.select({ employeeId: people.employeeId }).from(people).where(
            scopedSchoolId !== null
              ? and(eq(people.needsRescore, true), eq(people.schoolId, scopedSchoolId), eq(people.includeInFeedbackTracker, true))
              : and(eq(people.needsRescore, true), eq(people.includeInFeedbackTracker, true)),
          )
        : Promise.resolve([]),
      personIds.length
        ? db.select({ count: sql<number>`count(*)::int` }).from(observations).where(inArray(observations.observedEmployeeId, personIds))
        : Promise.resolve([{ count: 0 }]),
    ]);

    const totalObservations = obsCountResult[0]?.count ?? 0;

    const { contextStr, activeRubricSetSlug, matchedTeachers } = await buildCombinedContext(
      personIds,
      scopedPeople,
      scope,
      scopedSchoolId,
      rescoreRows.length,
      totalObservations,
      allRubricSets,
      rubricSetSlug ?? null,
      message,
    );

    /* Set SSE headers */
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let fullReply = "";
    let streamError = false;

    try {
      fullReply = await generateAIResponseStreamRaw(message, contextStr, (chunk) => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      });
    } catch (aiErr) {
      console.error("POST /ai/chat/stream AI error:", aiErr);
      fullReply = "I'm sorry — I wasn't able to generate a response right now. Please try again in a moment. In the meantime, you can check the Calibration Flags tab for the most recent data.";
      res.write(`data: ${JSON.stringify(fullReply)}\n\n`);
      streamError = true;
    }

    /* Persist messages if sessionId provided */
    if (sessionId != null) {
      await db.insert(chatMessages).values([
        { sessionId, role: "user",      content: message,   rubricSetSlug: activeRubricSetSlug },
        { sessionId, role: "assistant", content: fullReply, rubricSetSlug: activeRubricSetSlug },
      ]);
      await db
        .update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId));
    }

    /* Parse next-step chip suggestions from the sentinel the AI appends as its
       last line. The sentinel is kept in fullReply (and therefore in the DB)
       so that history loading can re-parse it; the client strips it visually. */
    const nextStepsMatch = fullReply.match(/\nNEXT_STEPS_JSON:(\[.*?\])\s*$/s);
    let nextSteps: string[] = [];
    try { if (nextStepsMatch) nextSteps = JSON.parse(nextStepsMatch[1]) as string[]; } catch { /* malformed */ }

    /* Emit combined metadata before closing the stream */
    const metaPayload: { matchedTeachers?: string[]; nextSteps?: string[] } = {};
    if (matchedTeachers.length > 0) metaPayload.matchedTeachers = matchedTeachers;
    if (nextSteps.length > 0)       metaPayload.nextSteps = nextSteps;
    if (Object.keys(metaPayload).length > 0) {
      res.write(`data: [META]${JSON.stringify(metaPayload)}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      if (!res.headersSent) {
        res.status(403).json({ error: err.message }); return;
      }
      res.write(`data: ${JSON.stringify("Access denied.")}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    console.error("POST /ai/chat/stream error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

/* ── POST /api/ai/chat ──────────────────────────────────────────── */
router.post("/chat", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const { message, schoolId: reqSchoolId, sessionId, rubricSetSlug } = req.body as {
      message?: string;
      schoolId?: number | null;
      sessionId?: number | null;
      rubricSetSlug?: string;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: "message is required" }); return;
    }

    if (reqSchoolId != null) {
      const access = await assertNetworkSchoolAccess(user, reqSchoolId);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    }

    /* Verify sessionId ownership if provided */
    if (sessionId != null) {
      const [sess] = await db
        .select({ id: chatSessions.id })
        .from(chatSessions)
        .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.employeeId, user.employeeId)))
        .limit(1);
      if (!sess) { res.status(403).json({ error: "Session not found" }); return; }
    }

    const scopedSchoolId = resolveSchoolId(user, reqSchoolId ?? null);
    const scope: "school" | "network" = scopedSchoolId !== null ? "school" : "network";

    const [scopedPeople, allRubricSets] = await Promise.all([
      getScopedPeople(scopedSchoolId),
      db.select({ id: rubricSets.id, slug: rubricSets.slug, name: rubricSets.name }).from(rubricSets),
    ]);
    const personIds = scopedPeople.map((p) => p.employeeId);

    const [rescoreRows, obsCountResult] = await Promise.all([
      personIds.length
        ? db.select({ employeeId: people.employeeId }).from(people).where(
            scopedSchoolId !== null
              ? and(eq(people.needsRescore, true), eq(people.schoolId, scopedSchoolId), eq(people.includeInFeedbackTracker, true))
              : and(eq(people.needsRescore, true), eq(people.includeInFeedbackTracker, true)),
          )
        : Promise.resolve([]),
      personIds.length
        ? db.select({ count: sql<number>`count(*)::int` }).from(observations).where(inArray(observations.observedEmployeeId, personIds))
        : Promise.resolve([{ count: 0 }]),
    ]);

    const totalObservations = obsCountResult[0]?.count ?? 0;

    const { contextStr, activeRubricSetSlug } = await buildCombinedContext(
      personIds,
      scopedPeople,
      scope,
      scopedSchoolId,
      rescoreRows.length,
      totalObservations,
      allRubricSets,
      rubricSetSlug ?? null,
      message,
    );

    let reply: string;
    try {
      reply = await generateAIResponseRaw(message, contextStr);
    } catch (aiErr) {
      console.error("POST /ai/chat AI error:", aiErr);
      reply = "I'm sorry — I wasn't able to generate a response right now. Please try again in a moment. In the meantime, you can check the Calibration Flags tab for the most recent data.";
    }

    /* Persist messages if sessionId provided */
    if (sessionId != null) {
      await db.insert(chatMessages).values([
        { sessionId, role: "user",      content: message, rubricSetSlug: activeRubricSetSlug },
        { sessionId, role: "assistant", content: reply,   rubricSetSlug: activeRubricSetSlug },
      ]);
      await db
        .update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId));
    }

    res.json({ reply });
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("POST /ai/chat error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/ai/insights ───────────────────────────────────────── */
router.get("/insights", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" }); return;
    }
    if (requested !== null) {
      const access = await assertNetworkSchoolAccess(user, requested);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    }
    const scopedSchoolId = resolveSchoolId(user, requested);
    const rubricSlug = typeof req.query.rubric === "string" ? req.query.rubric : null;
    const rubricSetId = rubricSlug ? await getRubricSetId(rubricSlug) : null;

    const personIds = await getPersonIds(scopedSchoolId);
    const domainAverages = await buildDomainAverages(personIds, rubricSetId);

    if (!domainAverages.length) {
      res.json({ topStrength: null, topGrowth: null, trendingSteps: [] }); return;
    }

    const sorted = [...domainAverages].sort((a, b) => b.avg - a.avg);
    const topStrength = sorted[0]!;
    const topGrowth   = sorted[sorted.length - 1]!;

    const lowThreshold = 0.7;
    const belowThreshold = sorted
      .filter((d) => d.avg < lowThreshold)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    const totalCount = domainAverages.reduce((s, d) => s + d.count, 0);
    const trendingSteps = belowThreshold.map((d) => ({
      pct:     totalCount > 0 ? Math.round((d.count / totalCount) * 100) : 0,
      domain:  d.domainName,
      avg:     d.avg,
      insight: `${d.domainName} is a high-priority growth area — avg score ${d.avg.toFixed(2)} across ${d.count} observation${d.count !== 1 ? "s" : ""}.`,
    }));

    res.json({
      topStrength: { domain: topStrength.domainName, avg: topStrength.avg, count: topStrength.count },
      topGrowth:   { domain: topGrowth.domainName,   avg: topGrowth.avg,   count: topGrowth.count },
      trendingSteps,
    });
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("GET /ai/insights error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/ai/calibration-flags ─────────────────────────────── */
router.get("/calibration-flags", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const requested = req.query.schoolId ? parseInt(req.query.schoolId as string, 10) : null;
    if (requested !== null && isNaN(requested)) {
      res.status(400).json({ error: "Invalid schoolId" }); return;
    }
    if (requested !== null) {
      const access = await assertNetworkSchoolAccess(user, requested);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    }
    const scopedSchoolId = resolveSchoolId(user, requested);
    const scope: "school" | "network" = scopedSchoolId !== null ? "school" : "network";
    const rubricSlug = typeof req.query.rubric === "string" ? req.query.rubric : null;
    const rubricSetId = rubricSlug ? await getRubricSetId(rubricSlug) : null;

    const personIds = await getPersonIds(scopedSchoolId);
    const flags = await buildCalibrationFlags(personIds, scope, rubricSetId);
    res.json(flags);
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("GET /ai/calibration-flags error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/ai/analysis ──────────────────────────────────────── */
router.post("/analysis", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const { rubricSetSlug, schoolId: reqSchoolId, sessionId } = req.body as {
      rubricSetSlug?: string;
      schoolId?: number | null;
      sessionId?: number | null;
    };

    if (reqSchoolId != null) {
      const access = await assertNetworkSchoolAccess(user, reqSchoolId);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    }

    const slug = rubricSetSlug?.trim() || "Q1";

    const scopedSchoolId = resolveSchoolId(user, reqSchoolId ?? null);
    const scope: "school" | "network" = scopedSchoolId !== null ? "school" : "network";

    const rubricSetId = await getRubricSetId(slug);
    const personIds = await getPersonIds(scopedSchoolId);

    const rescoreRows = personIds.length
      ? await db.select({ employeeId: people.employeeId }).from(people).where(
          scopedSchoolId !== null
            ? and(eq(people.needsRescore, true), eq(people.schoolId, scopedSchoolId), eq(people.includeInFeedbackTracker, true))
            : and(eq(people.needsRescore, true), eq(people.includeInFeedbackTracker, true)),
        )
      : [];

    const [domainAverages, calibrationFlags] = await Promise.all([
      buildDomainAverages(personIds, rubricSetId),
      buildCalibrationFlags(personIds, scope, rubricSetId),
    ]);

    const obsCountResult = personIds.length
      ? await db
          .select({ count: sql<number>`count(*)::int` })
          .from(observations)
          .where(
            rubricSetId != null
              ? and(inArray(observations.observedEmployeeId, personIds), eq(observations.rubricSetId, rubricSetId))
              : inArray(observations.observedEmployeeId, personIds)
          )
      : [{ count: 0 }];

    const totalObservations = obsCountResult[0]?.count ?? 0;

    if (totalObservations === 0) {
      res.status(422).json({
        error: "No observations have been recorded for this rubric period yet. Submit some observations first, then run the analysis.",
      });
      return;
    }

    if (domainAverages.length === 0) {
      res.status(422).json({
        error: "Observations exist for this period but none include domain scores. Score at least one domain in an observation to generate the analysis.",
      });
      return;
    }

    const context: AIContext = {
      scope,
      domainAverages,
      totalTeachers:     personIds.length,
      totalObservations,
      rescoreQueueCount: rescoreRows.length,
      calibrationFlags,
    };

    const structured = await generateStructuredInstantAnalysis(context, slug);

    /* Persist the narrative context as an assistant message for follow-up questions */
    if (sessionId != null) {
      const [sess] = await db
        .select({ id: chatSessions.id })
        .from(chatSessions)
        .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.employeeId, user.employeeId)))
        .limit(1);
      if (sess) {
        await db.insert(chatMessages).values({
          sessionId,
          role: "assistant",
          content: structured.narrativeForContext,
        });
        await db
          .update(chatSessions)
          .set({ updatedAt: new Date() })
          .where(eq(chatSessions.id, sessionId));
      }
    }

    res.json({ structured, rubricSetSlug: slug });
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("POST /ai/analysis error:", err);
    res.status(500).json({ error: "Failed to generate analysis. Please try again." });
  }
});

/* ── POST /api/ai/school-summary ──────────────────────────────────── */
router.post("/school-summary", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const { rubricSetSlug, schoolId: reqSchoolId } = req.body as {
      rubricSetSlug?: string;
      schoolId?: number | null;
    };

    if (reqSchoolId != null) {
      const access = await assertNetworkSchoolAccess(user, reqSchoolId);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    }

    const slug = rubricSetSlug?.trim() || "Q1";
    const scopedSchoolId = resolveSchoolId(user, reqSchoolId ?? null);
    const scope: "school" | "network" = scopedSchoolId !== null ? "school" : "network";

    const rubricSetId = await getRubricSetId(slug);
    if (rubricSetId === null) {
      res.status(404).json({ error: `Rubric set '${slug}' not found` }); return;
    }

    /* Determine whether this is a school-target or teacher-target rubric */
    const rubricRows = await db
      .select({ target: rubricSets.target })
      .from(rubricSets)
      .where(eq(rubricSets.id, rubricSetId))
      .limit(1);
    const isSchoolTarget = rubricRows[0]?.target === "SCHOOL";

    /* Count published observations for this rubric+scope */
    let publishedCount = 0;

    if (isSchoolTarget) {
      const whereClause = scopedSchoolId != null
        ? and(eq(observations.rubricSetId, rubricSetId), eq(observations.status, "published"), eq(observations.target, "SCHOOL"), eq(observations.schoolId, scopedSchoolId))
        : and(eq(observations.rubricSetId, rubricSetId), eq(observations.status, "published"), eq(observations.target, "SCHOOL"));
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(observations)
        .where(whereClause);
      publishedCount = row?.count ?? 0;
    } else {
      const personIds = await getPersonIds(scopedSchoolId);
      if (personIds.length > 0) {
        const [row] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(observations)
          .where(and(
            inArray(observations.observedEmployeeId, personIds),
            eq(observations.rubricSetId, rubricSetId),
            eq(observations.status, "published"),
          ));
        publishedCount = row?.count ?? 0;
      }
    }

    if (publishedCount === 0) {
      res.status(422).json({
        error: "No published observations found for this school and rubric period. Publish at least one observation first.",
      });
      return;
    }

    /* Build AI context */
    const personIds = await getPersonIds(scopedSchoolId);
    const [domainAverages, calibrationFlags] = await Promise.all([
      buildDomainAverages(personIds, rubricSetId),
      buildCalibrationFlags(personIds, scope, rubricSetId),
    ]);

    const rescoreRows = personIds.length > 0
      ? await db.select({ employeeId: people.employeeId }).from(people).where(
          scopedSchoolId !== null
            ? and(eq(people.needsRescore, true), eq(people.schoolId, scopedSchoolId), eq(people.includeInFeedbackTracker, true))
            : and(eq(people.needsRescore, true), eq(people.includeInFeedbackTracker, true)),
        )
      : [];

    const context: AIContext = {
      scope,
      domainAverages,
      totalTeachers:     personIds.length,
      totalObservations: publishedCount,
      rescoreQueueCount: rescoreRows.length,
      calibrationFlags,
    };

    const summary = await generateAnalysisSummary(context, slug);
    res.json({ summary });
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("POST /ai/school-summary error:", err);
    res.status(500).json({ error: "Failed to generate summary. Please try again." });
  }
});

/* ── POST /api/ai/chat/context  (DEV-ONLY) ────────────────────────────────
   Returns the assembled AI context string without calling Claude.
   Used by regression tests to verify qualitative data is correctly scoped
   to the requesting user's school without incurring an LLM call.
   Never available in production.                                           */
router.post("/chat/context", async (req, res) => {
  if (isProduction) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const user = req.user as Express.User;
    if (!user) { res.status(401).json({ error: "Authentication required" }); return; }

    const { message, schoolId: reqSchoolId, rubricSetSlug } = req.body as {
      message?: string;
      schoolId?: number | null;
      rubricSetSlug?: string;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: "message is required" }); return;
    }

    if (reqSchoolId != null) {
      const access = await assertNetworkSchoolAccess(user, reqSchoolId);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    }

    const scopedSchoolId = resolveSchoolId(user, reqSchoolId ?? null);
    const scope: "school" | "network" = scopedSchoolId !== null ? "school" : "network";

    const [scopedPeople, allRubricSets] = await Promise.all([
      getScopedPeople(scopedSchoolId),
      db.select({ id: rubricSets.id, slug: rubricSets.slug, name: rubricSets.name }).from(rubricSets),
    ]);
    const personIds = scopedPeople.map((p) => p.employeeId);

    const [rescoreRows, obsCountResult] = await Promise.all([
      personIds.length
        ? db.select({ employeeId: people.employeeId }).from(people).where(
            scopedSchoolId !== null
              ? and(eq(people.needsRescore, true), eq(people.schoolId, scopedSchoolId), eq(people.includeInFeedbackTracker, true))
              : and(eq(people.needsRescore, true), eq(people.includeInFeedbackTracker, true)),
          )
        : Promise.resolve([]),
      personIds.length
        ? db.select({ count: sql<number>`count(*)::int` }).from(observations).where(inArray(observations.observedEmployeeId, personIds))
        : Promise.resolve([{ count: 0 }]),
    ]);

    const totalObservations = obsCountResult[0]?.count ?? 0;

    const { contextStr, activeRubricSetSlug } = await buildCombinedContext(
      personIds,
      scopedPeople,
      scope,
      scopedSchoolId,
      rescoreRows.length,
      totalObservations,
      allRubricSets,
      rubricSetSlug ?? null,
      message,
    );

    res.json({ contextStr, activeRubricSetSlug, scopedTeacherCount: personIds.length });
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("POST /ai/chat/context error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
