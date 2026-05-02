/*
 * ai-service.ts
 *
 * Single Gemini swap point. All response generation lives here.
 * DB queries happen in the routes; this service only turns context data
 * into natural-language responses.
 *
 * To connect the real Gemini API:
 *   1. Replace the body of `generateAIResponse` below with your Gemini call.
 *   2. The `context` object already contains all the pre-fetched DB data
 *      you need to inject into the prompt.
 */

export interface DomainAvg {
  domainSlug: string;
  domainName: string;
  avg: number;
  count: number;
}

export interface CalibrationFlag {
  teacher?: string;
  school?: string;
  domain: string;
  schoolScore: number;
  networkScore: number;
  delta: number;
}

export interface PlateauAlert {
  teacherName: string;
  subject: string;
  gradeLevel: string[];
  domain: string;
  score: number;
  obsCount: number;
  firstDate: string;
  lastDate: string;
  weekRange: string;
}

export interface InsightResult {
  topStrength: { domain: string; avg: number; count: number } | null;
  topGrowth:   { domain: string; avg: number; count: number } | null;
}

export interface AIContext {
  scope: "school" | "network";
  domainAverages: DomainAvg[];
  totalTeachers: number;
  totalObservations: number;
  rescoreQueueCount: number;
  calibrationFlags: CalibrationFlag[];
  plateauAlerts: PlateauAlert[];
}

// ─── TODO: replace with Gemini call ─────────────────────────────────────────
//
// When you integrate Gemini:
//   async function generateAIResponse(message: string, context: AIContext): Promise<string> {
//     const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
//     const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
//     const prompt = buildPrompt(message, context);
//     const result = await model.generateContent(prompt);
//     return result.response.text();
//   }
//
// ─────────────────────────────────────────────────────────────────────────────

export function generateAIResponse(message: string, context: AIContext): string {
  const lc = message.toLowerCase();

  const topStrength = context.domainAverages.length
    ? [...context.domainAverages].sort((a, b) => b.avg - a.avg)[0]
    : null;
  const topGrowth = context.domainAverages.length
    ? [...context.domainAverages].sort((a, b) => a.avg - b.avg)[0]
    : null;

  const scopeLabel = context.scope === "school" ? "school" : "network";

  /* ── Calibration keyword ─── */
  if (lc.includes("calibrat")) {
    if (context.calibrationFlags.length === 0) {
      return `Good news — I found no calibration discrepancies (≥ 0.5 difference between School Coach and Network Walkthrough scores) in the current data. Your ${scopeLabel}'s scoring appears well-aligned across observers.`;
    }
    const flagList = context.calibrationFlags
      .slice(0, 3)
      .map((f) => {
        const subject = f.teacher ?? f.school ?? "Unknown";
        return `**${subject}** in "${f.domain}" (School Coach: ${f.schoolScore.toFixed(1)} vs Network: ${f.networkScore.toFixed(1)}, Δ ${f.delta.toFixed(1)})`;
      })
      .join("; ");
    return `I found **${context.calibrationFlags.length} calibration flag${context.calibrationFlags.length !== 1 ? "s" : ""}** where scores differ by ≥ 0.5 between School Coach and Network Walkthrough observations. The most notable: ${flagList}. A calibration session before the next round of walkthroughs is recommended.`;
  }

  /* ── Plateau keyword ─── */
  if (lc.includes("plateau") || lc.includes("stuck") || lc.includes("no improvement") || lc.includes("stagnant")) {
    if (context.plateauAlerts.length === 0) {
      return `Great news — no growth plateaus detected. All teachers in your ${scopeLabel} have shown score movement across their recent observations.`;
    }
    const names = context.plateauAlerts.slice(0, 3).map((p) => `**${p.teacherName}** (${p.domain}, ${p.obsCount} observations)`).join("; ");
    return `I've detected **${context.plateauAlerts.length} growth plateau${context.plateauAlerts.length !== 1 ? "s" : ""}** — teachers with no score improvement over 3+ consecutive observations: ${names}. Each of these teachers has remained at the same or lower score level for 4+ weeks.`;
  }

  /* ── Threshold / proficiency keyword ─── */
  if (lc.includes("threshold") || lc.includes("proficien") || lc.includes("0.7")) {
    const aboveThreshold = context.domainAverages.filter((d) => d.avg >= 0.7);
    const belowThreshold = context.domainAverages.filter((d) => d.avg < 0.7);
    if (!context.domainAverages.length) {
      return `No domain score data is available yet for your ${scopeLabel}. Once observations are recorded, I'll be able to tell you which domains are above or below the 0.7 proficiency threshold.`;
    }
    return `Across your ${scopeLabel}, **${aboveThreshold.length} domain${aboveThreshold.length !== 1 ? "s" : ""}** are at or above the 0.7 proficiency threshold, and **${belowThreshold.length}** are below. ${topGrowth ? `The biggest priority for growth is **${topGrowth.domainName}** at an average of ${topGrowth.avg.toFixed(2)}.` : ""}`;
  }

  /* ── Support keyword ─── */
  if (lc.includes("support") || lc.includes("priorit") || lc.includes("urgent") || lc.includes("help")) {
    const urgent = context.rescoreQueueCount;
    const plateaus = context.plateauAlerts.length;
    const flags = context.calibrationFlags.length;
    return `Based on current data, here are the most urgent support needs in your ${scopeLabel}: **${urgent} teacher${urgent !== 1 ? "s" : ""}** in the rescore queue${urgent > 0 ? " (walkthroughs scored below 0.7 needing follow-up)" : ""}, **${plateaus} growth plateau alert${plateaus !== 1 ? "s" : ""}**, and **${flags} calibration flag${flags !== 1 ? "s" : ""}**. ${topGrowth ? `Focus coaching attention on **${topGrowth.domainName}** (avg ${topGrowth.avg.toFixed(2)}) — the lowest-scoring domain ${scopeLabel}-wide.` : ""}`;
  }

  /* ── Trend keyword ─── */
  if (lc.includes("trend") || lc.includes("pattern") || lc.includes("common") || lc.includes("theme")) {
    if (!context.domainAverages.length) {
      return `No observation data has been recorded yet for your ${scopeLabel}. Add some observations and I'll surface trends for you.`;
    }
    const top3 = [...context.domainAverages].sort((a, b) => b.avg - a.avg).slice(0, 3);
    const bottom3 = [...context.domainAverages].sort((a, b) => a.avg - b.avg).slice(0, 3);
    const strengthList = top3.map((d) => `**${d.domainName}** (${d.avg.toFixed(2)})`).join(", ");
    const growthList = bottom3.map((d) => `**${d.domainName}** (${d.avg.toFixed(2)})`).join(", ");
    return `Across ${context.totalObservations} observations for ${context.totalTeachers} teacher${context.totalTeachers !== 1 ? "s" : ""} in your ${scopeLabel}, the strongest domains are: ${strengthList}. The areas most needing attention are: ${growthList}.`;
  }

  /* ── Domain name keyword match ─── */
  if (context.domainAverages.length) {
    const matched = context.domainAverages.find(
      (d) =>
        lc.includes(d.domainSlug.toLowerCase()) ||
        lc.includes(d.domainName.toLowerCase()),
    );
    if (matched) {
      const aboveBelow = matched.avg >= 0.7 ? "above" : "below";
      const profLabel  = matched.avg >= 0.7 ? "proficient" : "not yet proficient";
      return `**${matched.domainName}** has an average score of **${matched.avg.toFixed(2)}** across ${matched.count} observation${matched.count !== 1 ? "s" : ""} in your ${scopeLabel} — ${aboveBelow} the 0.7 threshold (${profLabel}). ${matched.avg < 0.7 ? "Consider a focused coaching cycle on this domain." : "Keep reinforcing this strength in upcoming walkthroughs."}`;
    }
  }

  /* ── Teacher name keyword ─── */
  if (context.plateauAlerts.length) {
    const matchedTeacher = context.plateauAlerts.find((p) =>
      lc.includes(p.teacherName.toLowerCase().split(" ")[0]) ||
      lc.includes(p.teacherName.toLowerCase()),
    );
    if (matchedTeacher) {
      return `**${matchedTeacher.teacherName}** is currently on a growth plateau in **${matchedTeacher.domain}**, scoring **${matchedTeacher.score.toFixed(1)}** across ${matchedTeacher.obsCount} consecutive observations over ${matchedTeacher.weekRange}. I'd recommend a targeted coaching conversation focused on this domain.`;
    }
  }

  /* ── Average / overview keyword ─── */
  if (lc.includes("average") || lc.includes("overall") || lc.includes("score") || lc.includes("how") || lc.includes("summary")) {
    if (!context.domainAverages.length) {
      return `No observation scores are recorded yet for your ${scopeLabel}. Once data is available, I can give you a full summary.`;
    }
    const overall = context.domainAverages.reduce((s, d) => s + d.avg, 0) / context.domainAverages.length;
    return `Your ${scopeLabel} has **${context.totalTeachers} teacher${context.totalTeachers !== 1 ? "s" : ""}** across **${context.totalObservations} observation${context.totalObservations !== 1 ? "s" : ""}**. The overall average score is **${overall.toFixed(2)}** across all domains. ${topStrength ? `Strongest domain: **${topStrength.domainName}** (${topStrength.avg.toFixed(2)}).` : ""} ${topGrowth ? `Biggest growth opportunity: **${topGrowth.domainName}** (${topGrowth.avg.toFixed(2)}).` : ""}`;
  }

  /* ── Fallback ─── */
  if (!context.domainAverages.length) {
    return `I don't have enough observation data yet for your ${scopeLabel} to answer that question. Once observations are logged, I can help with trends, domain breakdowns, calibration flags, and growth plateau alerts.`;
  }
  const overall = context.domainAverages.reduce((s, d) => s + d.avg, 0) / context.domainAverages.length;
  return `Based on **${context.totalObservations} observation${context.totalObservations !== 1 ? "s" : ""}** across your ${scopeLabel}, the overall average is **${overall.toFixed(2)}**. ${topStrength ? `Top strength: **${topStrength.domainName}** (${topStrength.avg.toFixed(2)}).` : ""} ${topGrowth ? `Top growth area: **${topGrowth.domainName}** (${topGrowth.avg.toFixed(2)}).` : ""} Try asking about calibration flags, growth plateaus, specific domains, or proficiency thresholds.`;
}
