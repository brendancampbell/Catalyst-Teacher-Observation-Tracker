/*
 * ai-service.ts
 *
 * Claude Opus swap point. All response generation lives here.
 * DB queries happen in the routes; this service only turns context data
 * into natural-language responses via Claude Opus (claude-opus-4-8).
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";

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
}

const GBF_SYSTEM_PROMPT = `You are a GBF (Growth-Based Feedback) Data Assistant embedded in a principal/instructional-leader dashboard. You help school leaders and network coaches understand their observation data and make coaching decisions.

Key GBF rubric context:
- Scores are on a 0–1 scale (not 0–100).
- The proficiency threshold is 0.7. A score ≥ 0.7 means a teacher is considered proficient in that domain.
- Scores below 0.7 indicate a growth area requiring coaching support.
- Calibration flags arise when a School Coach's scores differ by ≥ 0.5 from the Network Walkthrough score on the same teachers — indicating the coach's lens may not be aligned to the network standard.
- "Rescore queue" means teachers who received a walkthrough score below 0.7 and need a follow-up observation within 14 days.

Your responses should be:
- Concise, data-grounded, and actionable.
- Written for a principal or instructional coach audience.
- Honest about what the data shows, including areas of concern.
- Formatted with **bold** for key numbers and domain names when it aids readability.
- Always attribute insights to the actual data provided — do not invent numbers.`;

function buildContextBlock(context: AIContext): string {
  const scopeLabel = context.scope === "school" ? "school" : "network";
  const lines: string[] = [
    `## Current ${scopeLabel} data snapshot`,
    `- Scope: ${scopeLabel}`,
    `- Total teachers tracked: ${context.totalTeachers}`,
    `- Total observations: ${context.totalObservations}`,
    `- Rescore queue (walkthroughs below 0.7): ${context.rescoreQueueCount}`,
    "",
  ];

  if (context.domainAverages.length) {
    lines.push("### Domain averages (0–1 scale, ≥0.7 = proficient)");
    for (const d of context.domainAverages) {
      const status = d.avg >= 0.7 ? "✓ proficient" : "⚠ below threshold";
      lines.push(`- ${d.domainName}: ${d.avg.toFixed(3)} across ${d.count} observation(s) [${status}]`);
    }
    lines.push("");
  } else {
    lines.push("### Domain averages: No data yet");
    lines.push("");
  }

  if (context.calibrationFlags.length) {
    lines.push("### Calibration flags (score divergence ≥ 0.5 between coach and network)");
    for (const f of context.calibrationFlags) {
      const subject = f.teacher ?? f.school ?? "Unknown";
      lines.push(`- ${subject} | Domain: ${f.domain} | Coach avg: ${f.schoolScore.toFixed(2)} | Network avg: ${f.networkScore.toFixed(2)} | Δ ${f.delta.toFixed(2)}`);
    }
    lines.push("");
  } else {
    lines.push("### Calibration flags: None (all observers well-aligned)");
    lines.push("");
  }

  return lines.join("\n");
}

export async function generateAIResponse(message: string, context: AIContext): Promise<string> {
  const contextBlock = buildContextBlock(context);
  const userContent = `${contextBlock}\n---\n\nUser question: ${message}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      system: GBF_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const block = response.content[0];
    if (block?.type === "text") return block.text;
    return "I was unable to generate a response. Please try again.";
  } catch (err) {
    console.error("Claude chat error:", err);
    throw err;
  }
}

export async function generateAnalysisSummary(context: AIContext, rubricSetSlug: string): Promise<string> {
  const contextBlock = buildContextBlock(context);

  const prompt = `${contextBlock}
---

You are writing an executive analysis report for the rubric set "${rubricSetSlug}".

Write a 4-section narrative report with the following structure. Use the exact section headers shown:

**EXECUTIVE SUMMARY**
A 2–3 paragraph overview of the school's or network's overall performance this period. Reference the overall average score, number of teachers and observations, and the proportion of domains above and below the 0.7 proficiency threshold. Highlight whether the overall picture is strong, mixed, or a cause for concern.

**DOMAIN HIGHLIGHTS**
A domain-by-domain breakdown. For each domain, note its average score, whether it is above or below the 0.7 threshold, and what that means for teachers in that area. Call out the highest-scoring domain (a strength to celebrate) and the lowest-scoring domain (the top coaching priority). If no domain data exists, say so clearly.

**TEACHER GROWTH TRENDS**
Discuss growth patterns visible in the data. Mention the rescore queue count and what it signals about teachers who need follow-up observations. Note any domains where scores are trending in a positive direction and any that appear stagnant. Keep this grounded in the data provided.

**RECOMMENDED ACTIONS**
3–5 concrete, prioritized action items for the school or network leader based on the data. Be specific: reference domain names, calibration flags, and rescore queue teachers where relevant. Prioritize the most urgent items first (rescore queue, large calibration gaps, lowest-scoring domains).

End with a one-line disclaimer: "⚠ This analysis was generated by AI based on observation data as of the report date. Please verify key figures with your data team before sharing externally."`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      system: GBF_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const block = response.content[0];
    if (block?.type === "text") return block.text;
    return "Unable to generate analysis. Please try again.";
  } catch (err) {
    console.error("Claude analysis error:", err);
    throw err;
  }
}
