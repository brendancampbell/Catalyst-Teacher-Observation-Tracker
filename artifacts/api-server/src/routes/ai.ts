import { Router } from "express";
import { db } from "@workspace/db";
import {
  observations,
  observationScores,
  people,
  schools,
  rubricDomains,
  rubricSets,
  chatSessions,
  chatMessages,
} from "@workspace/db/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import {
  generateAIResponseRaw,
  generateAIResponseStreamRaw,
  generateAnalysisSummary,
  buildContextBlock,
  type AIContext,
  type CalibrationFlag,
  type DomainAvg,
} from "../services/ai-service";
import { effectiveSchoolId as resolveSchoolId, NoSchoolAssignedError } from "../middleware/auth";

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

/* ── Helper: build combined context string for one or multiple rubric sets ── */
async function buildCombinedContext(
  personIds: string[],
  scope: "school" | "network",
  rescoreQueueCount: number,
  totalObservations: number,
  allRubricSets: Array<{ id: number; slug: string; name: string }>,
  activeSlug: string | null,
  messageText: string,
): Promise<{ contextStr: string; activeRubricSetSlug: string | null }> {
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

  /* If only one rubric is relevant (or none), build a single context block */
  const slugList = Array.from(mentionedSlugs);

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
    return { contextStr: buildContextBlock(ctx), activeRubricSetSlug: singleSlug };
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

  return { contextStr: blocks.join("\n\n"), activeRubricSetSlug: activeSlug };
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
    const personIds = await getPersonIds(scopedSchoolId);

    const [rescoreRows, allRubricSets, obsCountResult] = await Promise.all([
      personIds.length
        ? db.select({ employeeId: people.employeeId }).from(people).where(
            scopedSchoolId !== null
              ? and(eq(people.needsRescore, true), eq(people.schoolId, scopedSchoolId), eq(people.includeInFeedbackTracker, true))
              : and(eq(people.needsRescore, true), eq(people.includeInFeedbackTracker, true)),
          )
        : Promise.resolve([]),
      db.select({ id: rubricSets.id, slug: rubricSets.slug, name: rubricSets.name }).from(rubricSets),
      personIds.length
        ? db.select({ count: sql<number>`count(*)::int` }).from(observations).where(inArray(observations.observedEmployeeId, personIds))
        : Promise.resolve([{ count: 0 }]),
    ]);

    const totalObservations = obsCountResult[0]?.count ?? 0;

    const { contextStr, activeRubricSetSlug } = await buildCombinedContext(
      personIds,
      scope,
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

    const personIds = await getPersonIds(scopedSchoolId);

    const [rescoreRows, allRubricSets, obsCountResult] = await Promise.all([
      personIds.length
        ? db.select({ employeeId: people.employeeId }).from(people).where(
            scopedSchoolId !== null
              ? and(eq(people.needsRescore, true), eq(people.schoolId, scopedSchoolId), eq(people.includeInFeedbackTracker, true))
              : and(eq(people.needsRescore, true), eq(people.includeInFeedbackTracker, true)),
          )
        : Promise.resolve([]),
      db.select({ id: rubricSets.id, slug: rubricSets.slug, name: rubricSets.name }).from(rubricSets),
      personIds.length
        ? db.select({ count: sql<number>`count(*)::int` }).from(observations).where(inArray(observations.observedEmployeeId, personIds))
        : Promise.resolve([{ count: 0 }]),
    ]);

    const totalObservations = obsCountResult[0]?.count ?? 0;

    const { contextStr, activeRubricSetSlug } = await buildCombinedContext(
      personIds,
      scope,
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
      const check = await checkSchool(requested);
      if (check === "not_found") { res.status(404).json({ error: "School not found" }); return; }
      if (check === "inactive")  { res.status(422).json({ error: "School is inactive" }); return; }
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
      const check = await checkSchool(requested);
      if (check === "not_found") { res.status(404).json({ error: "School not found" }); return; }
      if (check === "inactive")  { res.status(422).json({ error: "School is inactive" }); return; }
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

    const context: AIContext = {
      scope,
      domainAverages,
      totalTeachers:     personIds.length,
      totalObservations: obsCountResult[0]?.count ?? 0,
      rescoreQueueCount: rescoreRows.length,
      calibrationFlags,
    };

    const narrative = await generateAnalysisSummary(context, slug);

    /* Persist as an assistant message if a session was provided */
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
          content: narrative,
        });
        await db
          .update(chatSessions)
          .set({ updatedAt: new Date() })
          .where(eq(chatSessions.id, sessionId));
      }
    }

    res.json({ narrative, rubricSetSlug: slug });
  } catch (err) {
    if (err instanceof NoSchoolAssignedError) {
      res.status(403).json({ error: err.message }); return;
    }
    console.error("POST /ai/analysis error:", err);
    res.status(500).json({ error: "Failed to generate analysis. Please try again." });
  }
});

export default router;
