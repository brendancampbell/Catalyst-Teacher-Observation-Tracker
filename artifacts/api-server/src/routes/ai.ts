import { Router } from "express";
import { db } from "@workspace/db";
import {
  observations,
  observationScores,
  teachers,
  schools,
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

async function getTeacherIds(isNetworkScope: boolean, schoolId: number | null): Promise<number[]> {
  const rows = isNetworkScope
    ? await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.isActive, true))
    : await db.select({ id: teachers.id }).from(teachers).where(
        and(eq(teachers.isActive, true), eq(teachers.schoolId, schoolId!)),
      );
  return rows.map((r) => r.id);
}

async function buildDomainAverages(teacherIds: number[]): Promise<DomainAvg[]> {
  if (!teacherIds.length) return [];

  const rows = await db
    .select({
      domainSlug: observationScores.domainSlug,
      score:      observationScores.score,
    })
    .from(observationScores)
    .innerJoin(observations, eq(observations.id, observationScores.observationId))
    .where(inArray(observations.teacherId, teacherIds));

  const byDomain = new Map<string, number[]>();
  for (const r of rows) {
    const bucket = byDomain.get(r.domainSlug) ?? [];
    bucket.push(r.score);
    byDomain.set(r.domainSlug, bucket);
  }

  return Array.from(byDomain.entries()).map(([domainSlug, scores]) => ({
    domainSlug,
    domainName: domainSlug,
    avg:        scores.reduce((s, v) => s + v, 0) / scores.length,
    count:      scores.length,
  }));
}

async function buildCalibrationFlags(
  teacherIds: number[],
  scope: "school" | "network",
): Promise<CalibrationFlag[]> {
  if (!teacherIds.length) return [];

  const rows = await db
    .select({
      teacherId:     observations.teacherId,
      teacherName:   teachers.name,
      schoolId:      teachers.schoolId,
      schoolName:    schools.name,
      domainSlug:    observationScores.domainSlug,
      score:         observationScores.score,
      isWalkthrough: observations.isWalkthrough,
      rubricSetId:   observations.rubricSetId,
    })
    .from(observationScores)
    .innerJoin(observations, eq(observations.id, observationScores.observationId))
    .innerJoin(teachers, eq(teachers.id, observations.teacherId))
    .leftJoin(schools, eq(schools.id, teachers.schoolId))
    .where(inArray(observations.teacherId, teacherIds));

  if (scope === "school") {
    /* Per-teacher discrepancy within the school ──────────────────── */
    type Key = string;
    const groupMap = new Map<
      Key,
      { coachScores: number[]; walkthroughScores: number[]; teacherName: string; domain: string }
    >();

    for (const r of rows) {
      const key: Key = `${r.teacherId}|${r.domainSlug}|${r.rubricSetId}`;
      const entry = groupMap.get(key) ?? {
        coachScores:       [],
        walkthroughScores: [],
        teacherName:       r.teacherName,
        domain:            r.domainSlug,
      };
      if (r.isWalkthrough) entry.walkthroughScores.push(r.score);
      else                  entry.coachScores.push(r.score);
      groupMap.set(key, entry);
    }

    const flags: CalibrationFlag[] = [];
    for (const entry of groupMap.values()) {
      if (!entry.coachScores.length || !entry.walkthroughScores.length) continue;
      const coachAvg    = entry.coachScores.reduce((s, v) => s + v, 0) / entry.coachScores.length;
      const networkAvg  = entry.walkthroughScores.reduce((s, v) => s + v, 0) / entry.walkthroughScores.length;
      const delta = Math.abs(coachAvg - networkAvg);
      if (delta >= 0.5) {
        flags.push({
          teacher:     entry.teacherName,
          domain:      entry.domain,
          schoolScore: coachAvg,
          networkScore: networkAvg,
          delta,
        });
      }
    }
    return flags.sort((a, b) => b.delta - a.delta);
  }

  /* Network scope: aggregate coach scores per school+domain+rubricSet ── */
  type NetKey = string;
  const schoolMap = new Map<
    NetKey,
    { coachScores: number[]; walkthroughScores: number[]; schoolName: string; domain: string }
  >();

  for (const r of rows) {
    const schoolLabel = r.schoolName ?? `school-${r.schoolId}`;
    const key: NetKey = `${r.schoolId}|${r.domainSlug}|${r.rubricSetId}`;
    const entry = schoolMap.get(key) ?? {
      coachScores:       [],
      walkthroughScores: [],
      schoolName:        schoolLabel,
      domain:            r.domainSlug,
    };
    if (r.isWalkthrough) entry.walkthroughScores.push(r.score);
    else                  entry.coachScores.push(r.score);
    schoolMap.set(key, entry);
  }

  const flags: CalibrationFlag[] = [];
  for (const entry of schoolMap.values()) {
    if (!entry.coachScores.length || !entry.walkthroughScores.length) continue;
    const coachAvg   = entry.coachScores.reduce((s, v) => s + v, 0) / entry.coachScores.length;
    const networkAvg = entry.walkthroughScores.reduce((s, v) => s + v, 0) / entry.walkthroughScores.length;
    const delta = Math.abs(coachAvg - networkAvg);
    if (delta >= 0.5) {
      flags.push({
        school:      entry.schoolName,
        domain:      entry.domain,
        schoolScore: coachAvg,
        networkScore: networkAvg,
        delta,
      });
    }
  }
  return flags.sort((a, b) => b.delta - a.delta);
}

async function buildPlateauAlerts(teacherIds: number[]): Promise<PlateauAlert[]> {
  if (!teacherIds.length) return [];

  const rows = await db
    .select({
      teacherId:   observations.teacherId,
      teacherName: teachers.name,
      subject:     teachers.subject,
      gradeLevel:  teachers.gradeLevel,
      domainSlug:  observationScores.domainSlug,
      score:       observationScores.score,
      obsDate:     observations.date,
    })
    .from(observationScores)
    .innerJoin(observations, eq(observations.id, observationScores.observationId))
    .innerJoin(teachers, eq(teachers.id, observations.teacherId))
    .where(inArray(observations.teacherId, teacherIds))
    .orderBy(observations.date);

  type SeriesKey = string;
  type ScorePoint = { date: string; score: number };
  const seriesMap = new Map<
    SeriesKey,
    { teacherName: string; subject: string; gradeLevel: string[]; domain: string; points: ScorePoint[] }
  >();

  for (const r of rows) {
    const key: SeriesKey = `${r.teacherId}|${r.domainSlug}`;
    const entry = seriesMap.get(key) ?? {
      teacherName: r.teacherName,
      subject:     r.subject,
      gradeLevel:  r.gradeLevel as string[],
      domain:      r.domainSlug,
      points:      [],
    };
    entry.points.push({ date: r.obsDate, score: r.score });
    seriesMap.set(key, entry);
  }

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
      domain:      entry.domain,
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

    const teacherIds = await getTeacherIds(isNetworkScope, user.schoolId ?? null);
    const domainAverages = await buildDomainAverages(teacherIds);

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

    const teacherIds = await getTeacherIds(isNetworkScope, user.schoolId ?? null);
    const flags = await buildCalibrationFlags(teacherIds, scope);
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

    const teacherIds = await getTeacherIds(isNetworkScope, user.schoolId ?? null);
    const alerts = await buildPlateauAlerts(teacherIds);
    res.json(alerts);
  } catch (err) {
    console.error("GET /ai/plateau-alerts error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
