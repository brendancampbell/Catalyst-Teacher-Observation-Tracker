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

export interface InsightResult {
  topStrength: { domain: string; avg: number; count: number } | null;
  topGrowth:   { domain: string; avg: number; count: number } | null;
}

export interface AIContext {
  scope: "school" | "network";
  rubricSetName?: string;
  domainAverages: DomainAvg[];
  totalTeachers: number;
  totalObservations: number;
  rescoreQueueCount: number;
  calibrationFlags: CalibrationFlag[];
}

const CATALYST_SYSTEM_PROMPT = `You are a Catalyst Data Assistant embedded in a principal/instructional-leader dashboard. You help school leaders and network coaches understand their observation data and make coaching decisions.

Key Catalyst rubric context:
- Scores are on a 0–1 scale (not 0–100).
- The proficiency threshold is 0.7. A score ≥ 0.7 means a teacher is considered proficient in that domain.
- Scores below 0.7 indicate a growth area requiring coaching support.
- Calibration flags arise when a School Coach's scores differ by ≥ 0.5 from the Network Walkthrough score on the same teachers — indicating the coach's lens may not be aligned to the network standard.
- "Rescore queue" means teachers who received a walkthrough score below 0.7 and need a follow-up observation within 14 days.
- When the context includes a "Lowest-scoring teachers" or "Highest-scoring teachers" ranked list, use those names and scores directly to answer questions like "who is my weakest teacher?" or "who is my top performer?" Reference specific names and their averages in your answer.

Your responses should be:
- Concise, data-grounded, and actionable.
- Written for a principal or instructional coach audience.
- Honest about what the data shows, including areas of concern.
- Use **bold** only for conclusions and key takeaway phrases. Do not bold raw counts, observation totals, or input figures.
- Always attribute insights to the actual data provided — do not invent numbers.`;

export function buildContextBlock(context: AIContext): string {
  const scopeLabel = context.scope === "school" ? "school" : "network";
  const rubricLabel = context.rubricSetName ? ` — Rubric: ${context.rubricSetName}` : "";
  const lines: string[] = [
    `## Current ${scopeLabel} data snapshot${rubricLabel}`,
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
      system: CATALYST_SYSTEM_PROMPT,
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

export async function generateAIResponseStream(
  message: string,
  context: AIContext,
  onChunk: (text: string) => void,
): Promise<string> {
  const contextBlock = buildContextBlock(context);
  const userContent = `${contextBlock}\n---\n\nUser question: ${message}`;

  let fullText = "";

  const stream = anthropic.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 8192,
    system: CATALYST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      const chunk = event.delta.text;
      fullText += chunk;
      onChunk(chunk);
    }
  }

  await stream.finalMessage();
  return fullText;
}

export async function generateAIResponseRaw(message: string, contextStr: string): Promise<string> {
  const userContent = `${contextStr}\n---\n\nUser question: ${message}`;
  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      system: CATALYST_SYSTEM_PROMPT,
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

export async function generateAIResponseStreamRaw(
  message: string,
  contextStr: string,
  onChunk: (text: string) => void,
): Promise<string> {
  const userContent = `${contextStr}\n---\n\nUser question: ${message}`;
  let fullText = "";

  const stream = anthropic.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 8192,
    system: CATALYST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      const chunk = event.delta.text;
      fullText += chunk;
      onChunk(chunk);
    }
  }

  await stream.finalMessage();
  return fullText;
}

export interface InstantAnalysisStructured {
  contextLine: string;
  summary: string;
  findings: Array<{
    type: "pattern" | "leverage" | "flag";
    lead: string;
    detail: string;
  }>;
  chips: [string, string, string];
  narrativeForContext: string;
}

export async function generateStructuredInstantAnalysis(
  context: AIContext,
  rubricSetSlug: string,
): Promise<InstantAnalysisStructured> {
  const contextBlock = buildContextBlock(context);
  const domainCount = context.domainAverages.length;
  const contextLine = `${rubricSetSlug} rubric set · ${context.totalTeachers} teacher${context.totalTeachers !== 1 ? "s" : ""} · ${context.totalObservations} observation${context.totalObservations !== 1 ? "s" : ""} · ${domainCount} domain${domainCount !== 1 ? "s" : ""}`;

  const prompt = `${contextBlock}
---
You are generating an Instant Analysis card for a school principal's dashboard. The dashboard's Summary tab ALREADY shows raw score tables and domain bars — do NOT repeat numeric tables or per-domain score lists here.

This card shows the SO WHAT (what the pattern means) and NOW WHAT (prioritized next moves).

Return ONLY valid JSON with exactly this shape — no markdown fences, no extra keys:

{
  "summary": "2–3 sentences interpreting the overall pattern. Use **double asterisks** around ONE key takeaway conclusion phrase only — never around raw counts or numbers. Use at most two hard numbers.",
  "findings": [
    {
      "type": "pattern",
      "lead": "4–8 word lead clause describing whether weakness is systemic or isolated",
      "detail": "One supporting sentence grounded in the actual data."
    },
    {
      "type": "leverage",
      "lead": "4–8 word lead clause naming the highest-impact coaching move",
      "detail": "One supporting sentence grounded in the actual data."
    },
    {
      "type": "flag",
      "lead": "4–8 word lead clause naming the single calibration or outlier issue",
      "detail": "One supporting sentence grounded in the actual data."
    }
  ],
  "chips": [
    "Specific follow-up question the principal would ask (10–15 words, referencing real domain or teacher data)",
    "Second specific follow-up question",
    "Third specific follow-up question"
  ],
  "narrativeForContext": "3–5 sentences capturing the key patterns, top coaching priority, and recommended next steps. This is stored as context so follow-up questions can reference it."
}`;

  const response = await anthropic.messages.create({
    model:      "claude-opus-4-8",
    max_tokens: 1200,
    system:     CATALYST_SYSTEM_PROMPT,
    messages:   [{ role: "user", content: prompt }],
  });

  const block = response.content[0];
  if (block?.type !== "text") throw new Error("Unexpected Claude response type");

  const text = block.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(text) as Omit<InstantAnalysisStructured, "contextLine">;
  return { ...parsed, contextLine };
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
      system: CATALYST_SYSTEM_PROMPT,
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
