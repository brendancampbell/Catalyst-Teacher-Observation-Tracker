import { Router } from "express";
import { db } from "@workspace/db";
import {
  observations,
  observationScores,
  teachers,
  schools,
  rubricDomains,
  rubricSets,
  users,
} from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  generateAIResponse,
  type AIContext,
  type CalibrationFlag,
  type PlateauAlert,
  type DomainAvg,
} from "../services/ai-service";

const router = Router();

/* ── helpers ────────────────────────────────────────────────────── */

function weeksBetween(a: string, b: string): number {
  const msPerWeek = 1000 * 60 * 60 * 24 * 7;
  return Math.round(Math.abs(new Date(b).getTime() - new Date(a).getTime()) / msPerWeek);
}

async function getRubricSetId(slug: string): Promise<number | null> {
  const rows = await db.select({ id: rubricSets.id }).from(rubricSets).where(eq(rubricSets.slug, slug)).limit(1);
  return rows[0]?.id ?? null;
}

async function getTeacherIds(isNetworkScope: boolean, schoolId: number | null): Promise<number[]> {
  const rows = isNetworkScope
    ? await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.isActive, true))
    : await db.select({ id: teachers.id }).from(teachers).where(
        and(eq(teachers.isActive, true), eq(teachers.schoolId, schoolId!)),
      );
  return rows.map((r) => r.id);
}

/** Fetch a slug→label map for the given slugs from rubric_domains. */
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

async function buildDomainAverages(teacherIds: number[], rubricSetId?: number | null): Promise<DomainAvg[]> {
  if (!teacherIds.length) return [];

  const whereClause = rubricSetId != null
    ? and(inArray(observations.teacherId, teacherIds), eq(observations.rubricSetId, rubricSetId))
    : inArray(observations.teacherId, teacherIds);

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
  teacherIds: number[],
  scope: "school" | "network",
  rubricSetId?: number | null,
): Promise<CalibrationFlag[]> {
  if (!teacherIds.length) return [];

  /* Scope to observations of relevant teachers, non-walkthrough only */
  const baseWhere = rubricSetId != null
    ? and(inArray(observations.teacherId, teacherIds), eq(observations.rubricSetId, rubricSetId), eq(observations.isWalkthrough, false))
    : and(inArray(observations.teacherId, teacherIds), eq(observations.isWalkthrough, false));

  const rows = await db
    .select({
      observerId:   observations.observerId,
      observerName: users.name,
      domainSlug:   observationScores.domainSlug,
      score:        observationScores.score,
    })
    .from(observationScores)
    .innerJoin(observations, eq(observations.id, observationScores.observationId))
    .leftJoin(users, eq(users.id, observations.observerId))
    .where(baseWhere);

  if (!rows.length) return [];

  /* Network average per domain (all observers in scope) */
  const domainAllScores = new Map<string, number[]>();
  for (const r of rows) {
    const arr = domainAllScores.get(r.domainSlug) ?? [];
    arr.push(r.score);
    domainAllScores.set(r.domainSlug, arr);
  }
  const domainNetAvg = new Map<string, number>();
  for (const [slug, scores] of domainAllScores) {
    domainNetAvg.set(slug, scores.reduce((s, v) => s + v, 0) / scores.length);
  }

  /* Group by observer + domain */
  type Key = string;
  const observerMap = new Map<Key, { observerName: string; domain: string; scores: number[] }>();
  for (const r of rows) {
    if (!r.observerId) continue;
    const key: Key = `${r.observerId}|${r.domainSlug}`;
    const entry = observerMap.get(key) ?? {
      observerName: r.observerName ?? `Observer ${r.observerId}`,
      domain:       r.domainSlug,
      scores:       [],
    };
    entry.scores.push(r.score);
    observerMap.set(key, entry);
  }

  const allSlugs = Array.from(new Set(rows.map((r) => r.domainSlug)));
  const names = await slugNameMap(allSlugs);

  const flags: CalibrationFlag[] = [];
  for (const entry of observerMap.values()) {
    if (entry.scores.length < 2) continue; // need ≥2 observations to flag
    const netAvg  = domainNetAvg.get(entry.domain) ?? 0;
    const obsAvg  = entry.scores.reduce((s, v) => s + v, 0) / entry.scores.length;
    const delta   = Math.abs(obsAvg - netAvg);
    if (delta >= 0.5) {
      flags.push({
        teacher:      entry.observerName, // observer name in teacher field
        domain:       names.get(entry.domain) ?? entry.domain,
        schoolScore:  obsAvg,             // observer's avg (reusing field)
        networkScore: netAvg,             // network avg for that domain
        delta,
      });
    }
  }
  return flags.sort((a, b) => b.delta - a.delta);
}

async function buildPlateauAlerts(teacherIds: number[], rubricSetId?: number | null): Promise<PlateauAlert[]> {
  if (!teacherIds.length) return [];

  const whereClause = rubricSetId != null
    ? and(inArray(observations.teacherId, teacherIds), eq(observations.rubricSetId, rubricSetId))
    : inArray(observations.teacherId, teacherIds);

  const rows = await db
    .select({
      teacherId:    observations.teacherId,
      teacherFirst: teachers.firstName,
      teacherLast:  teachers.lastName,
      subject:      teachers.subject,
      gradeLevel:   teachers.gradeLevel,
      domainSlug:   observationScores.domainSlug,
      score:        observationScores.score,
      obsDate:      observations.date,
    })
    .from(observationScores)
    .innerJoin(observations, eq(observations.id, observationScores.observationId))
    .innerJoin(teachers, eq(teachers.id, observations.teacherId))
    .where(whereClause)
    .orderBy(observations.date);

  type SeriesKey = string;
  type ScorePoint = { date: string; score: number };
  const seriesMap = new Map<
    SeriesKey,
    { teacherName: string; subject: string; gradeLevel: string[]; domain: string; points: ScorePoint[] }
  >();

  for (const r of rows) {
    const key: SeriesKey = `${r.teacherId}|${r.domainSlug}`;
    if (!seriesMap.has(key)) {
      seriesMap.set(key, {
        teacherName: `${r.teacherFirst} ${r.teacherLast}`.trim(),
        subject:     r.subject,
        gradeLevel:  r.gradeLevel as string[],
        domain:      r.domainSlug,
        points:      [],
      });
    }
    seriesMap.get(key)!.points.push({ date: r.obsDate, score: r.score });
  }

  const allSlugs = Array.from(new Set(rows.map((r) => r.domainSlug)));
  const names = await slugNameMap(allSlugs);

  const alerts: PlateauAlert[] = [];
  for (const entry of seriesMap.values()) {
    const pts = entry.points.sort((a, b) => a.date.localeCompare(b.date));
    if (pts.length < 3) continue;

    let streak = 1;
    let streakStart = pts[0]!;
    let bestStreak = 1;
    let bestStart = pts[0]!;
    let bestEnd = pts[0]!;

    for (let i = 1; i < pts.length; i++) {
      if (pts[i]!.score <= pts[i - 1]!.score) {
        streak++;
        if (streak > bestStreak) {
          bestStreak = streak;
          bestStart  = streakStart;
          bestEnd    = pts[i]!;
        }
      } else {
        streak = 1;
        streakStart = pts[i]!;
      }
    }

    if (bestStreak < 3) continue;

    const weeks = weeksBetween(bestStart.date, bestEnd.date);
    if (weeks < 4) continue;

    alerts.push({
      teacherName: entry.teacherName,
      subject:     entry.subject,
      gradeLevel:  entry.gradeLevel,
      domain:      names.get(entry.domain) ?? entry.domain,
      score:       bestEnd.score,
      obsCount:    bestStreak,
      firstDate:   bestStart.date,
      lastDate:    bestEnd.date,
      weekRange:   `${weeks} week${weeks !== 1 ? "s" : ""}`,
    });
  }

  return alerts.sort((a, b) => b.obsCount - a.obsCount);
}

/* ── POST /api/ai/chat ──────────────────────────────────────────── */
router.post("/chat", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const { message } = req.body as { message?: string };

    if (!message?.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const isNetworkScope = user.role === "NETWORK_LEADER" || user.role === "NETWORK_ADMIN";
    const scope: "school" | "network" = isNetworkScope ? "network" : "school";

    const teacherIds = await getTeacherIds(isNetworkScope, user.schoolId ?? null);

    const rescoreRows = teacherIds.length
      ? isNetworkScope
        ? await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.needsRescore, true))
        : await db.select({ id: teachers.id }).from(teachers).where(
            and(eq(teachers.needsRescore, true), eq(teachers.schoolId, user.schoolId!)),
          )
      : [];

    const [domainAverages, calibrationFlags, plateauAlerts] = await Promise.all([
      buildDomainAverages(teacherIds),
      buildCalibrationFlags(teacherIds, scope),
      buildPlateauAlerts(teacherIds),
    ]);

    const obsCountResult = teacherIds.length
      ? await db
          .select({ count: sql<number>`count(*)::int` })
          .from(observations)
          .where(inArray(observations.teacherId, teacherIds))
      : [{ count: 0 }];

    const context: AIContext = {
      scope,
      domainAverages,
      totalTeachers:     teacherIds.length,
      totalObservations: obsCountResult[0]?.count ?? 0,
      rescoreQueueCount: rescoreRows.length,
      calibrationFlags,
      plateauAlerts,
    };

    const reply = generateAIResponse(message, context);
    res.json({ reply });
  } catch (err) {
    console.error("POST /ai/chat error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/ai/insights ───────────────────────────────────────── */
router.get("/insights", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const isNetworkScope = user.role === "NETWORK_LEADER" || user.role === "NETWORK_ADMIN";
    const rubricSlug = typeof req.query.rubric === "string" ? req.query.rubric : null;
    const rubricSetId = rubricSlug ? await getRubricSetId(rubricSlug) : null;

    const teacherIds = await getTeacherIds(isNetworkScope, user.schoolId ?? null);
    const domainAverages = await buildDomainAverages(teacherIds, rubricSetId);

    if (!domainAverages.length) {
      res.json({ topStrength: null, topGrowth: null, trendingSteps: [] });
      return;
    }

    const sorted = [...domainAverages].sort((a, b) => b.avg - a.avg);
    const topStrength = sorted[0]!;
    const topGrowth   = sorted[sorted.length - 1]!;

    /* trendingSteps: bottom-quartile domains ranked by observation count
       (most observed low-scoring domains = highest coaching focus need) */
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
      topStrength: {
        domain: topStrength.domainName,
        avg:    topStrength.avg,
        count:  topStrength.count,
      },
      topGrowth: {
        domain: topGrowth.domainName,
        avg:    topGrowth.avg,
        count:  topGrowth.count,
      },
      trendingSteps,
    });
  } catch (err) {
    console.error("GET /ai/insights error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/ai/calibration-flags ─────────────────────────────── */
router.get("/calibration-flags", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const isNetworkScope = user.role === "NETWORK_LEADER" || user.role === "NETWORK_ADMIN";
    const scope: "school" | "network" = isNetworkScope ? "network" : "school";
    const rubricSlug = typeof req.query.rubric === "string" ? req.query.rubric : null;
    const rubricSetId = rubricSlug ? await getRubricSetId(rubricSlug) : null;

    const teacherIds = await getTeacherIds(isNetworkScope, user.schoolId ?? null);
    const flags = await buildCalibrationFlags(teacherIds, scope, rubricSetId);
    res.json(flags);
  } catch (err) {
    console.error("GET /ai/calibration-flags error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/ai/plateau-alerts ─────────────────────────────────── */
router.get("/plateau-alerts", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const isNetworkScope = user.role === "NETWORK_LEADER" || user.role === "NETWORK_ADMIN";
    const rubricSlug = typeof req.query.rubric === "string" ? req.query.rubric : null;
    const rubricSetId = rubricSlug ? await getRubricSetId(rubricSlug) : null;

    const teacherIds = await getTeacherIds(isNetworkScope, user.schoolId ?? null);
    const alerts = await buildPlateauAlerts(teacherIds, rubricSetId);
    res.json(alerts);
  } catch (err) {
    console.error("GET /ai/plateau-alerts error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
