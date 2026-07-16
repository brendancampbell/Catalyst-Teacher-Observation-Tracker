import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Clock, Plus,
  TrendingUp, TrendingDown, BarChart2, Sparkles, Send,
  Activity, Globe2, FileText,
  RefreshCw, Pencil, Trash2, Square, PanelLeft, X, AlertCircle, Copy,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { safeReturnTo } from "@/lib/safeReturnTo";
import {
  fetchRescoreQueue,
  fetchOverdueObservations,
  fetchDashboard,
  fetchDistrictSummary,
  fetchNetworkAverages,
  fetchRubricSets,
  createObservation,
  fetchAIInsights,
  fetchAICalibrationFlags,
  fetchOverdueActionSteps,
  streamAIChat,
  generateAIAnalysis,
  fetchChatSessions,
  createChatSession,
  fetchChatSessionMessages,
  renameChatSession,
  deleteChatSession,
  HttpError,
  type RescoreQueueItem,
  type OverdueTeacher,
  type OverdueActionStep,
  type RubricSetRow,
  type AICalibrationFlag,
  type AIInsightsResponse,
  type AIChatSession,
  type AIChatMessage,
  type InstantAnalysisStructured,
} from "@/lib/api";
import type { Teacher, Score } from "@/data/dummy";
import type { CategoryEntry, DomainEntry } from "@/lib/api";
import { NewObservationModal } from "@/components/NewObservationModal";
import { QualitativeThemesCard } from "@/components/QualitativeThemesCard";
import { useUser } from "@/context/UserContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const NAVY                  = "#1034B4";
const YELLOW                = "#FFB500";
const PROFICIENCY_THRESHOLD = 0.7;
const WARNING_THRESHOLD     = 0.5;

function getDueStatus(dueDateStr: string | null): { label: string; color: string; urgent: boolean } {
  if (!dueDateStr) return { label: "No due date", color: "#94a3b8", urgent: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + "T00:00:00");
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0)  return { label: `Overdue by ${Math.abs(diffDays)}d`, color: "#dc2626", urgent: true };
  if (diffDays === 0) return { label: "Due today",               color: "#ea580c", urgent: true };
  if (diffDays <= 3)  return { label: `Due in ${diffDays}d`,    color: "#ea580c", urgent: true };
  return { label: `Due in ${diffDays}d`, color: "#16a34a", urgent: false };
}

type ChatMsg = { role: "user" | "ai"; text: string; instantAnalysis?: InstantAnalysisStructured; matchedTeachers?: string[]; nextSteps?: string[] };

/* Strips the NEXT_STEPS_JSON sentinel line from AI response text so the raw
   sentinel is never visible to the user. Also handles partial sentinels that
   occur when a response is stopped mid-stream. */
function stripNextStepsSentinel(text: string): string {
  return text.replace(/\n+NEXT_STEPS_JSON:.*$/s, "").trimEnd();
}

/* Parses the NEXT_STEPS_JSON sentinel from a DB-stored AI message, used when
   restoring chip rows from chat history. */
function parseNextStepsFromSentinel(text: string): string[] {
  const m = text.match(/\nNEXT_STEPS_JSON:(\[.*?\])\s*$/s);
  if (!m) return [];
  try { return JSON.parse(m[1]) as string[]; } catch { return []; }
}

/* Maps server AIChatMessage[] → ChatMsg[], using the persisted
   instant-analysis structured card from the server response. */
function mapServerMessages(messages: AIChatMessage[]): ChatMsg[] {
  return messages.map((m) => {
    const role = m.role === "user" ? "user" as const : "ai" as const;
    if (role === "ai") {
      const nextSteps = parseNextStepsFromSentinel(m.content);
      const base: ChatMsg = { role, text: stripNextStepsSentinel(m.content), nextSteps: nextSteps.length ? nextSteps : undefined };
      if (m.instantAnalysis) {
        const ia = m.instantAnalysis as InstantAnalysisStructured;
        if (Array.isArray(ia.findings) && ia.findings.length > 0 && ia.summary) {
          return { ...base, instantAnalysis: ia };
        }
      }
      return base;
    }
    return { role, text: m.content };
  });
}

/* ── Narrative helpers ──────────────────────────────── */

function renderInlineText(text: string): React.ReactNode[] {
  return text.split("**").map((part, pi) => {
    if (pi % 2 === 1) {
      if (/^\s*[\d,\.%]+\s*$/.test(part)) return <span key={pi}>{part}</span>;
      return <strong key={pi} style={{ fontWeight: 600 }}>{part}</strong>;
    }
    return <span key={pi}>{part}</span>;
  });
}

/** Convert markdown text to an HTML string suitable for ClipboardItem text/html.
 *  Supports: headings (with navy color + sized fonts), bold, bullet/numbered
 *  lists, ALL-CAPS section headers, and markdown tables. */
function markdownToHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  /* Pre-group consecutive |-prefixed lines into table segments, exactly as
     AINarrativeRenderer does, so multi-line tables survive line-by-line pass. */
  const rawLines = text.split("\n");
  type Seg = { kind: "table"; lines: string[] } | { kind: "line"; content: string };
  const segments: Seg[] = [];
  let si = 0;
  while (si < rawLines.length) {
    if (rawLines[si].trim().startsWith("|")) {
      const tLines: string[] = [];
      while (si < rawLines.length && rawLines[si].trim().startsWith("|")) {
        tLines.push(rawLines[si++]);
      }
      segments.push({ kind: "table", lines: tLines });
    } else {
      segments.push({ kind: "line", content: rawLines[si++] });
    }
  }

  const parts: string[] = [];
  let listType: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listType) { parts.push(listType === "ul" ? "</ul>" : "</ol>"); listType = null; }
  };

  for (const seg of segments) {
    /* ── Markdown table ── */
    if (seg.kind === "table") {
      closeList();
      const parsed = parseMarkdownTable(seg.lines);
      if (parsed && parsed.headers.length > 0) {
        const th = (h: string) =>
          `<th style="border:1px solid #cbd5e1;padding:6px 10px;background:#f1f5f9;text-align:left;font-weight:600">${inline(h)}</th>`;
        const td = (c: string) =>
          `<td style="border:1px solid #cbd5e1;padding:6px 10px">${inline(c)}</td>`;
        parts.push(
          `<table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:13px">` +
          `<thead><tr>${parsed.headers.map(th).join("")}</tr></thead>` +
          `<tbody>${parsed.rows.map((r) => `<tr>${r.map(td).join("")}</tr>`).join("")}</tbody>` +
          `</table>`,
        );
      } else {
        for (const l of seg.lines) parts.push(`<p>${inline(l)}</p>`);
      }
      continue;
    }

    const rawLine = seg.content;
    const trimmed = rawLine.trim();
    if (!trimmed) { closeList(); continue; }
    const stripped = trimmed.replace(/\*\*/g, "");

    /* Markdown heading — sized and navy-coloured to match app rendering */
    const hm = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      closeList();
      const lvl = hm[1].length;
      const sz = lvl === 1 ? 20 : lvl === 2 ? 17 : lvl === 3 ? 15 : 14;
      parts.push(
        `<h${lvl} style="color:#1034B4;font-size:${sz}px;margin:12px 0 4px;font-weight:700">` +
        `${inline(hm[2])}</h${lvl}>`,
      );
      continue;
    }

    /* ALL-CAPS section header (mirrors AINarrativeRenderer detection) */
    if (stripped.length >= 4 && stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped)) {
      closeList();
      parts.push(
        `<h2 style="color:#1034B4;font-size:13px;margin:12px 0 4px;font-weight:700;` +
        `letter-spacing:0.05em;text-transform:uppercase">${inline(stripped)}</h2>`,
      );
      continue;
    }

    /* Bullet list */
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ") || trimmed.startsWith("* ")) {
      if (listType !== "ul") { closeList(); parts.push("<ul>"); listType = "ul"; }
      const content = trimmed.replace(/^[-•*]\s+/, "");
      const indented = ((rawLine.match(/^(\s*)/) ?? ["", ""])[1]).length >= 2;
      parts.push(`<li${indented ? ' style="margin-left:16px"' : ""}>${inline(content)}</li>`);
      continue;
    }

    /* Numbered list */
    const nm = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (nm) {
      if (listType !== "ol") { closeList(); parts.push("<ol>"); listType = "ol"; }
      parts.push(`<li>${inline(nm[2])}</li>`);
      continue;
    }

    /* Regular paragraph */
    closeList();
    parts.push(`<p>${inline(trimmed)}</p>`);
  }
  closeList();
  return `<html><body style="font-family:sans-serif;font-size:14px;line-height:1.6">${parts.join("")}</body></html>`;
}

function parseMarkdownTable(lines: string[]): { headers: string[]; rows: string[][] } | null {
  const tableLines = lines.filter((l) => l.trim().startsWith("|"));
  if (tableLines.length < 2) return null;
  const sepIdx = tableLines.findIndex((l) => /^\s*\|[\s\-|:]+\|\s*$/.test(l));
  if (sepIdx < 1) return null;
  const parseRow = (line: string) =>
    line.split("|").slice(1, -1).map((c) => c.trim());
  return {
    headers: parseRow(tableLines[sepIdx - 1] ?? ""),
    rows: tableLines.slice(sepIdx + 1).map(parseRow),
  };
}

export function AINarrativeRenderer({ text }: { text: string }) {
  const rawLines = text.split("\n");

  /* Pre-group consecutive |-prefixed lines into table segments so we can
     detect multi-line markdown tables before line-by-line rendering. */
  type Seg = { kind: "table"; lines: string[] } | { kind: "line"; content: string };
  const segments: Seg[] = [];
  let idx = 0;
  while (idx < rawLines.length) {
    if (rawLines[idx].trim().startsWith("|")) {
      const tLines: string[] = [];
      while (idx < rawLines.length && rawLines[idx].trim().startsWith("|")) {
        tLines.push(rawLines[idx++]);
      }
      segments.push({ kind: "table", lines: tLines });
    } else {
      segments.push({ kind: "line", content: rawLines[idx++] });
    }
  }

  return (
    <div style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
      {segments.map((seg, si) => {
        /* ── Table block ─────────────────────────────────────────────── */
        if (seg.kind === "table") {
          const table = parseMarkdownTable(seg.lines);
          if (table) {
            return (
              <div key={si} style={{ overflowX: "auto", marginBottom: 12, marginTop: 4 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  {table.headers.length > 0 && (
                    <thead>
                      <tr>
                        {table.headers.map((h, hi) => (
                          <th key={hi} style={{ backgroundColor: NAVY, color: "white", padding: "6px 10px", textAlign: "left", fontWeight: 600, fontFamily: "'Libre Franklin', sans-serif", whiteSpace: "nowrap", borderBottom: `2px solid ${YELLOW}` }}>
                            {renderInlineText(h)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {table.rows.map((row, ri) => (
                      <tr key={ri} style={{ backgroundColor: ri % 2 === 0 ? "white" : "#F8FAFC" }}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ padding: "5px 10px", borderBottom: "1px solid #E2E8F0", verticalAlign: "top", lineHeight: "1.5" }}>
                            {renderInlineText(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          /* Fallback: render pipe lines as plain paragraphs */
          return seg.lines.map((l, li) => (
            <p key={`${si}-${li}`} style={{ fontSize: 13, lineHeight: "1.6", margin: "0 0 10px" }}>{l}</p>
          ));
        }

        /* ── Single line ─────────────────────────────────────────────── */
        const line = seg.content;
        const trimmed = line.trim();
        if (!trimmed) return <div key={si} style={{ height: 8 }} />;

        const stripped = trimmed.replace(/\*\*/g, "");

        /* Markdown headings */
        if (trimmed.startsWith("#")) {
          const level = (trimmed.match(/^#+/) ?? [""])[0].length;
          const content = trimmed.replace(/^#+\s*/, "").replace(/\*\*/g, "");
          if (!content) return <div key={si} style={{ height: 8 }} />;
          if (level === 1) {
            return (
              <p key={si} style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12, fontStyle: "italic" }}>
                {content}
              </p>
            );
          }
          if (level >= 3) {
            /* Style B — Libre Franklin subheading with yellow left accent bar */
            return (
              <div key={si} style={{ marginTop: si > 0 ? 14 : 0, marginBottom: 5, borderLeft: `3px solid ${YELLOW}`, paddingLeft: 8 }}>
                <span style={{ fontFamily: "'Libre Franklin', sans-serif", fontSize: 13, color: NAVY, fontWeight: 700 }}>
                  {content}
                </span>
              </div>
            );
          }
          /* level === 2 — Style A: Bebas Neue with yellow underline */
          return (
            <div key={si} style={{ marginTop: si > 0 ? 20 : 0, marginBottom: 8 }}>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: NAVY, letterSpacing: "0.04em", fontWeight: "bold", paddingBottom: 3, borderBottom: `2.5px solid ${YELLOW}`, display: "inline-block" }}>
                {content.toUpperCase()}
              </span>
            </div>
          );
        }

        /* Section header — ALL CAPS line */
        if (stripped.length >= 4 && stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped)) {
          return (
            <div key={si} style={{ marginTop: si > 0 ? 20 : 0, marginBottom: 8 }}>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: NAVY, letterSpacing: "0.04em", fontWeight: "bold", paddingBottom: 3, borderBottom: `2.5px solid ${YELLOW}`, display: "inline-block" }}>
                {stripped}
              </span>
            </div>
          );
        }

        /* Bullet point */
        if (trimmed.startsWith("- ") || trimmed.startsWith("• ") || trimmed.startsWith("* ")) {
          const content = trimmed.replace(/^[-•*]\s+/, "");
          const leadingSpaces = (line.match(/^(\s+)/) ?? [""])[0].length;
          const nestLevel = leadingSpaces >= 4 ? 2 : leadingSpaces >= 2 ? 1 : 0;
          const bulletSymbol = nestLevel === 2 ? "▪" : nestLevel === 1 ? "◦" : "•";
          const marginLeft = nestLevel * 16;
          return (
            <div key={si} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 5, marginLeft: marginLeft || 0 }}>
              <span style={{ color: YELLOW, fontWeight: "bold", marginTop: 1, flexShrink: 0, lineHeight: "1.5" }}>{bulletSymbol}</span>
              <span style={{ fontSize: 13, lineHeight: "1.55" }}>{renderInlineText(content)}</span>
            </div>
          );
        }

        /* Numbered list item */
        const numberedMatch = trimmed.match(/^(\d+)\.\s+([\s\S]*)/);
        if (numberedMatch) {
          const leadingSpaces = (line.match(/^(\s+)/) ?? [""])[0].length;
          const nestLevel = leadingSpaces >= 4 ? 2 : leadingSpaces >= 2 ? 1 : 0;
          const marginLeft = nestLevel * 16;
          return (
            <div key={si} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 5, marginLeft: marginLeft || 0 }}>
              <span style={{ color: YELLOW, fontWeight: "bold", marginTop: 1, flexShrink: 0, lineHeight: "1.5", minWidth: 18 }}>{numberedMatch[1]}.</span>
              <span style={{ fontSize: 13, lineHeight: "1.55" }}>{renderInlineText(numberedMatch[2])}</span>
            </div>
          );
        }

        /* Warning / note line */
        if (trimmed.startsWith("⚠") || trimmed.toLowerCase().startsWith("warning") || trimmed.toLowerCase().startsWith("note:")) {
          return (
            <div key={si} style={{ backgroundColor: "#FEF3C7", borderLeft: `3px solid ${YELLOW}`, padding: "6px 10px", borderRadius: 4, marginBottom: 6, fontSize: 13, lineHeight: "1.5" }}>
              {renderInlineText(trimmed)}
            </div>
          );
        }

        /* Regular paragraph */
        return (
          <p key={si} style={{ fontSize: 13, lineHeight: "1.6", margin: "0 0 10px" }}>
            {renderInlineText(trimmed)}
          </p>
        );
      })}
    </div>
  );
}

/* ── Instant Analysis Card ──────────────────────────── */

const FINDING_CONFIG = {
  pattern:  { Icon: BarChart2,   bg: "#EEF2FF", color: "#4F46E5" },
  leverage: { Icon: TrendingUp,  bg: "#DCFCE7", color: "#15803D" },
  flag:     { Icon: AlertCircle, bg: "#FEF3C7", color: "#D97706" },
} as const;

interface InstantAnalysisCardProps {
  structured: InstantAnalysisStructured;
  onChipClick: (text: string) => void;
  onSummaryTabClick: () => void;
}

function InstantAnalysisCard({ structured, onChipClick, onSummaryTabClick }: InstantAnalysisCardProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    /* Converts **bold** markdown to <strong> tags for HTML clipboard, matching renderInlineText() */
    const inlineMd = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    /* Strips **bold** markers for plain-text clipboard */
    const stripMd = (s: string) => s.replace(/\*\*/g, "");

    /* Plain-text version */
    const plainLines: string[] = [structured.contextLine, "", stripMd(structured.summary)];
    if (structured.findings.length > 0) {
      plainLines.push("");
      for (const f of structured.findings) plainLines.push(`• ${f.lead} — ${f.detail}`);
    }
    const plain = plainLines.join("\n");

    /* Rich-HTML version — contextLine as italic label, summary with inline bold, findings bolded leads */
    const htmlLines: string[] = [
      `<p><em>${esc(structured.contextLine)}</em></p>`,
      `<p>${inlineMd(structured.summary)}</p>`,
    ];
    if (structured.findings.length > 0) {
      htmlLines.push("<ul>");
      for (const f of structured.findings) {
        htmlLines.push(`<li><strong>${esc(f.lead)}</strong> — ${esc(f.detail)}</li>`);
      }
      htmlLines.push("</ul>");
    }
    const html = htmlLines.join("");

    const doSuccess = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
    const fallback = () => navigator.clipboard.writeText(plain).then(doSuccess).catch(() => {});
    if (typeof ClipboardItem !== "undefined") {
      const item = new ClipboardItem({
        "text/html":  new Blob([html],  { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      try {
        navigator.clipboard.write([item]).then(doSuccess).catch(fallback);
      } catch {
        fallback();
      }
    } else {
      fallback();
    }
  }

  return (
    <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 18px", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", backgroundColor: NAVY, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Sparkles size={14} color="white" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: NAVY }}>Catalyst Data Assistant</span>
            <span style={{ fontSize: 11, fontWeight: 700, backgroundColor: YELLOW, color: NAVY, borderRadius: 20, padding: "1px 8px" }}>Instant analysis</span>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{structured.contextLine}</div>
        </div>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={handleCopy}
            title="Copy summary"
            aria-label="Copy summary"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", color: "#64748b", transition: "background 0.12s, color 0.12s" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.color = NAVY; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "white"; e.currentTarget.style.color = "#64748b"; }}
          >
            <Copy size={13} />
          </button>
          {copied && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, backgroundColor: "#1e293b", color: "white", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap", pointerEvents: "none", zIndex: 10 }}>
              Copied!
            </div>
          )}
        </div>
      </div>

      {/* Summary */}
      <p style={{ fontSize: 13, lineHeight: 1.65, color: "#1e293b", marginBottom: 14 }}>
        {renderInlineText(structured.summary)}
      </p>

      {/* Findings */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {structured.findings.map((f, i) => {
          const cfg = FINDING_CONFIG[f.type] ?? FINDING_CONFIG.pattern;
          const { Icon } = cfg;
          const showOverdueBadge = f.type === "flag" && (structured.overdueActionStepCount ?? 0) > 0;
          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", backgroundColor: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                <Icon size={13} color={cfg.color} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, lineHeight: 1.55, color: "#1e293b", margin: 0 }}>
                  <strong>{f.lead}</strong>{" — "}{f.detail}
                </p>
                {showOverdueBadge && (
                  <span style={{
                    display: "inline-block",
                    marginTop: 5,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#B45309",
                    backgroundColor: "#FEF3C7",
                    border: "1px solid #FCD34D",
                    borderRadius: 20,
                    padding: "1px 8px",
                  }}>
                    {structured.overdueActionStepCount} overdue step{structured.overdueActionStepCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary tab link */}
      <div style={{ marginBottom: 14 }}>
        <button
          onClick={onSummaryTabClick}
          style={{ fontSize: 12, color: NAVY, fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          See the full scores in the Summary tab →
        </button>
      </div>

      {/* Chips */}
      <div>
        <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 6 }}>Where would you like to start?</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-start" }}>
          {structured.chips.map((chip, i) => (
            <button
              key={i}
              onClick={() => onChipClick(chip)}
              style={{ fontSize: 12, fontWeight: 500, color: NAVY, border: `1.5px solid ${NAVY}`, borderRadius: 20, padding: "4px 12px", background: "white", cursor: "pointer", transition: "background 0.12s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#EEF2FF"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "white"; }}
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

export default function ActionCenterPage() {
  const { currentUser } = useUser();
  const queryClient     = useQueryClient();
  const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const [, navigate] = useLocation();

  const searchParams = new URLSearchParams(window.location.search);
  const rubricFromUrl    = searchParams.get("rubric") ?? undefined;
  const schoolIdFromUrl  = searchParams.get("schoolId");
  const _parsedSchoolId  = schoolIdFromUrl ? parseInt(schoolIdFromUrl, 10) : null;
  const schoolId         = _parsedSchoolId !== null && isNaN(_parsedSchoolId) ? null : _parsedSchoolId;
  const schoolNameFromUrl = searchParams.get("schoolName") ?? "This School";
  const schoolAbbreviation = searchParams.get("schoolAbbreviation") ?? currentUser?.schoolAbbreviation ?? null;

  const returnTo = safeReturnTo(
    searchParams.get("returnTo"),
    baseUrl + "/",
  );

  /* ── Rescore queue ─────────────────────────────────── */
  const { data: queue = [], isLoading, isError } = useQuery<RescoreQueueItem[]>({
    queryKey: ["rescoreQueue", schoolId],
    queryFn:  () => fetchRescoreQueue(schoolId),
    staleTime: 30_000,
  });

  /* ── Overdue observations ───────────────────────────── */
  const { data: overdueTeachers = [] } = useQuery<OverdueTeacher[]>({
    queryKey: ["overdueObservations", schoolId],
    queryFn:  () => fetchOverdueObservations(schoolId),
    staleTime: 60_000,
  });

  /* ── Dashboard data ──────────────────────────────────── */
  const { data: quarters = [], isLoading: quartersLoading } = useQuery<RubricSetRow[]>({
    queryKey: ["quarters"],
    queryFn:  () => fetchRubricSets(),
    staleTime: 60_000,
  });

  /* Validate the URL rubric against the loaded list.  While quarters are
     still loading we cannot validate, so we hold off (treat as absent) to
     avoid firing queries with a stale/deleted slug.  Once loaded, if the
     slug doesn't exist we fall back to the first available rubric and
     silently replace the URL so the stale param is gone on the next visit. */
  const rawRubricFromUrl = searchParams.get("rubric") ?? undefined;
  const rubricValid      = !quartersLoading && rawRubricFromUrl
    ? quarters.some((q) => q.slug === rawRubricFromUrl)
    : false;
  const validatedRubric  = quartersLoading ? undefined
    : rubricValid ? rawRubricFromUrl
    : undefined;

  useEffect(() => {
    if (quartersLoading || !rawRubricFromUrl || quarters.length === 0) return;
    if (!quarters.some((q) => q.slug === rawRubricFromUrl)) {
      const sp = new URLSearchParams(window.location.search);
      sp.set("rubric", quarters[0].slug);
      window.location.replace(`${window.location.pathname}?${sp.toString()}`);
    }
  }, [quartersLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeQuarter        = validatedRubric ?? quarters[0]?.slug;
  const activeQuarterObj     = quarters.find((q) => q.slug === activeQuarter);
  const activeQuarterId      = activeQuarterObj?.id ?? quarters[0]?.id ?? 0;
  const activeQuarterAudience: "STEM" | "HUMANITIES" | "ALL" = activeQuarterObj?.subjectAudience ?? "ALL";

  const { data: dashData } = useQuery({
    queryKey: ["dashboard", activeQuarter, schoolId],
    queryFn:  () => fetchDashboard(activeQuarter, schoolId),
    staleTime: 60_000,
    enabled:  !!activeQuarter,
  });

  const allTeachers: Teacher[]      = dashData?.teachers   ?? [];
  const categories:  CategoryEntry[] = dashData?.categories ?? [];
  const allDomains:  DomainEntry[]   = categories.flatMap((c) => c.domains);

  /* ── AI data ─────────────────────────────────────────── */
  const { data: insights } = useQuery<AIInsightsResponse>({
    queryKey: ["ai-insights", activeQuarter, schoolId],
    queryFn:  () => fetchAIInsights(activeQuarter, schoolId),
    staleTime: 60_000,
  });

  const { data: calibrationFlags = [] } = useQuery<AICalibrationFlag[]>({
    queryKey: ["ai-calibration-flags", activeQuarter, schoolId],
    queryFn:  () => fetchAICalibrationFlags(activeQuarter, schoolId),
    staleTime: 60_000,
  });

  /* ── Overdue action steps ─────────────────────────────── */
  const { data: overdueActionSteps = [] } = useQuery<OverdueActionStep[]>({
    queryKey: ["overdueActionSteps", schoolId],
    queryFn:  () => fetchOverdueActionSteps(schoolId),
    staleTime: 60_000,
  });

  /* ── Role helpers ────────────────────────────────────────── */
  const isSchoolScoped = currentUser?.role === "COACH" || currentUser?.role === "SCHOOL_LEADER";

  /* ── District summary (for network comparison — network roles only) ── */
  const { data: districtData } = useQuery({
    queryKey: ["district-summary", activeQuarter],
    queryFn:  () => fetchDistrictSummary(activeQuarter),
    staleTime: 60_000,
    enabled:  !!activeQuarter && !isSchoolScoped,
  });

  /* ── Network averages (for school-scoped roles only) ─────── */
  const { data: networkAvgsData } = useQuery({
    queryKey: ["network-averages", activeQuarter],
    queryFn:  () => fetchNetworkAverages(activeQuarter),
    staleTime: 60_000,
    enabled:  !!activeQuarter && isSchoolScoped,
  });

  /* ── Compute real school avg ─────────────────────────── */
  const schoolAvg = (() => {
    if (!allTeachers.length || !allDomains.length) return null;
    const vals: number[] = [];
    for (const t of allTeachers) {
      for (const d of allDomains) {
        const obs = t.observations;
        if (!obs?.length) continue;
        const sorted = [...obs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const last = sorted[sorted.length - 1];
        const s = last?.scores?.[d.id];
        if (s !== undefined) vals.push(s as number);
      }
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();

  /* ── Active tab ─────────────────────────────────────── */
  const [activeTab, setActiveTab] = useState("summary");

  /* ── Intervention sub-tab ───────────────────────────── */
  const [interventionTab, setInterventionTab] = useState<"rescore" | "overdue" | "calibration" | "overdueActionSteps">("rescore");

  /* ── Domain comparison ───────────────────────────────── */
  const [domainSeg, setDomainSeg] = useState<"school" | "dept" | "grade">("school");

  const domainCompData = useMemo(() => {
    if (!allTeachers.length || !allDomains.length) return null;

    type TD = { subject: string; grades: string[]; scores: Record<string, number> };
    const teacherData: TD[] = [];
    for (const t of allTeachers) {
      if (!t.observations?.length) continue;
      const sorted = [...t.observations].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const last = sorted[sorted.length - 1];
      if (!last?.scores) continue;
      teacherData.push({
        subject: t.subject || "Other",
        grades:  Array.isArray(t.gradeLevel) ? t.gradeLevel : [],
        scores:  last.scores as Record<string, number>,
      });
    }
    if (!teacherData.length) return null;

    function avgForGroup(members: TD[]): Record<string, number | null> {
      const out: Record<string, number | null> = {};
      for (const d of allDomains) {
        const vals = members.map((m) => m.scores[d.id]).filter((v) => v !== undefined && v !== null) as number[];
        out[d.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      }
      return out;
    }

    const schoolAvgs = avgForGroup(teacherData);

    /* departments */
    const deptMap: Record<string, TD[]> = {};
    for (const td of teacherData) {
      if (!deptMap[td.subject]) deptMap[td.subject] = [];
      deptMap[td.subject].push(td);
    }
    const depts = Object.keys(deptMap).sort();
    const deptAvgs: Record<string, Record<string, number | null>> = {};
    for (const dept of depts) deptAvgs[dept] = avgForGroup(deptMap[dept]);

    /* grades */
    const gradeMap: Record<string, TD[]> = {};
    for (const td of teacherData) {
      for (const g of td.grades) {
        if (!gradeMap[g]) gradeMap[g] = [];
        gradeMap[g].push(td);
      }
    }
    const gradeOrder = (g: string) => g === "K" ? -1 : parseInt(g, 10);
    const grades = Object.keys(gradeMap).sort((a, b) => gradeOrder(a) - gradeOrder(b));
    const gradeAvgs: Record<string, Record<string, number | null>> = {};
    for (const g of grades) gradeAvgs[g] = avgForGroup(gradeMap[g]);

    /* sort domains lowest → highest by school avg */
    const sortedDomains = [...allDomains].sort((a, b) => {
      const sa = schoolAvgs[a.id] ?? Infinity;
      const sb = schoolAvgs[b.id] ?? Infinity;
      return sa - sb;
    });

    const belowThreshold = Object.values(schoolAvgs).filter((v) => v !== null && (v as number) < PROFICIENCY_THRESHOLD).length;

    return { schoolAvgs, depts, deptAvgs, grades, gradeAvgs, sortedDomains, belowThreshold };
  }, [allTeachers, allDomains]);

  /* ── Network comparison memo ─────────────────────────── */
  const networkCompData = useMemo(() => {
    if (!allDomains.length) return null;

    if (districtData?.schools?.length) {
      /* Network-scoped: compute from per-school breakdown */
      const networkAvgs: Record<string, number | null> = {};
      for (const d of allDomains) {
        const vals = districtData.schools
          .map((s) => s.domainAverages[d.id])
          .filter((v): v is number => v !== null && v !== undefined);
        networkAvgs[d.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      }
      return { networkAvgs };
    }

    if (networkAvgsData?.domainAverages) {
      /* School-scoped: use pre-computed aggregate from new endpoint */
      return { networkAvgs: networkAvgsData.domainAverages };
    }

    return null;
  }, [districtData, networkAvgsData, allDomains]);

  /* ── Add-Observation modal state ────────────────────── */
  const [addObsTeacherId,     setAddObsTeacherId]     = useState<string | null>(null);
  const [newObsOpen,          setNewObsOpen]           = useState(false);
  const [newObsIsWalkthrough, setNewObsIsWalkthrough]  = useState(false);
  const [saving, setSaving]                            = useState(false);

  function handleAddObsClick(employeeId: string, asWalkthrough = false) {
    setAddObsTeacherId(employeeId);
    setNewObsIsWalkthrough(asWalkthrough);
    setNewObsOpen(true);
  }

  async function handleSubmitObs(
    teacherId:           string,
    date:                string,
    scores:              Record<string, Score>,
    strengths:           string,
    growthAreas:         string,
    isWalkthrough:       boolean,
    time:                string,
    course:              string,
    _draftId?:           string,
    newActionStep?:      { text: string; dueDate: string },
    masterActionStepId?: number,
  ): Promise<string> {
    setSaving(true);
    try {
      const obs = await createObservation({
        teacherId,
        rubricSetId:       activeQuarterId,
        date,
        time:              time        || undefined,
        course:            course      || undefined,
        scores,
        strengths:         strengths   || undefined,
        growthAreas:       growthAreas || undefined,
        observer:          currentUser?.name ?? "Unknown",
        observerId:        currentUser?.id,
        isWalkthrough,
        newActionStep,
        masterActionStepId,
      });
      queryClient.invalidateQueries({ queryKey: ["rescoreQueue"] });
      queryClient.invalidateQueries({ queryKey: ["overdueObservations"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["ai-calibration-flags"] });
      queryClient.invalidateQueries({ queryKey: ["ai-insights"] });
      queryClient.invalidateQueries({ queryKey: ["overdueActionSteps"] });
      return obs.id;
    } catch (err) {
      console.error("Failed to save observation:", err);
      return "";
    } finally {
      setSaving(false);
    }
  }

  /* ── Chat state ──────────────────────────────────────── */
  const [activeChatId, setActiveChatId]             = useState<number | null>(null);
  const [chatMsgs, setChatMsgs]                     = useState<ChatMsg[]>([]);
  const [copiedMsgIdx, setCopiedMsgIdx]             = useState<number | null>(null);
  const [chatInput, setChatInput]                   = useState("");
  const [chatTyping, setChatTyping]                 = useState(false);
  const [streamingText, setStreamingText]           = useState("");

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<AIChatSession[]>({
    queryKey: ["chatSessions"],
    queryFn:  fetchChatSessions,
    staleTime: 60_000,
  });

  const {
    data:    rawServerMessages,
    isLoading: messagesLoading,
    isError:   messagesError,
  } = useQuery<AIChatMessage[]>({
    queryKey: ["chatMessages", activeChatId],
    queryFn:  () => fetchChatSessionMessages(activeChatId!),
    enabled:  activeChatId !== null,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const [renamingId, setRenamingId]                 = useState<number | null>(null);
  const [renameValue, setRenameValue]               = useState("");
  const [deleteConfirmId, setDeleteConfirmId]       = useState<number | null>(null);
  const [isInstantAnalyzing, setIsInstantAnalyzing] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen]   = useState(false);

  const chatEndRef                                  = useRef<HTMLDivElement>(null);
  const activeChatIdRef                             = useRef<number | null>(null);
  const abortControllerRef                          = useRef<AbortController | null>(null);
  const chatTextareaRef                             = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs, chatTyping, streamingText]);

  /* Sync server messages into chatMsgs whenever the React Query cache updates.
     Skip the sync while a stream is active to avoid clobbering in-flight chunks. */
  useEffect(() => {
    if (!chatTyping && !streamingText && rawServerMessages && activeChatId !== null) {
      setChatMsgs(mapServerMessages(rawServerMessages));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawServerMessages]);

  /* Reset textarea height when input is cleared (e.g. after send) */
  useEffect(() => {
    if (!chatInput && chatTextareaRef.current) {
      chatTextareaRef.current.style.height = "auto";
    }
  }, [chatInput]);

  function selectSession(id: number) {
    setActiveChatId(id);
    activeChatIdRef.current = id;
    /* Serve cached messages immediately — no spinner on repeat visits.
       useQuery will background-refresh if stale; the sync useEffect above
       will update chatMsgs when fresh data arrives. */
    const cached = queryClient.getQueryData<AIChatMessage[]>(["chatMessages", id]);
    setChatMsgs(cached ? mapServerMessages(cached) : []);
  }

  function handleStopGeneration() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setChatTyping(false);
    if (streamingText) {
      setChatMsgs((prev) => [...prev, { role: "ai", text: stripNextStepsSentinel(streamingText) }]);
      setStreamingText("");
    }
  }

  function handleNewChat() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setActiveChatId(null);
    activeChatIdRef.current = null;
    setChatMsgs([]);
    setChatInput("");
    setChatTyping(false);
    setStreamingText("");
  }

  async function handleSendChat(overrideText?: string) {
    const text = (overrideText ?? chatInput).trim();
    if (!text || chatTyping || !!streamingText) return;
    setChatMsgs((prev) => [...prev, { role: "user", text }]);
    setChatInput("");
    setChatTyping(true);
    setStreamingText("");

    /* Capture session at send-time so we can guard against mid-flight
       chat switches before the reply arrives. */
    let sessionId = activeChatIdRef.current;
    const sentForSession = sessionId;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      if (sessionId === null) {
        const newSession = await createChatSession(text);
        sessionId = newSession.id;
        setActiveChatId(newSession.id);
        activeChatIdRef.current = newSession.id;
        queryClient.setQueryData<AIChatSession[]>(["chatSessions"], (prev = []) => [newSession, ...prev]);
      }

      let accumulated = "";

      const meta = await streamAIChat(text, schoolId, sessionId, (chunk) => {
        accumulated += chunk;
        /* Switch from typing indicator to streaming text on first chunk */
        setChatTyping(false);
        /* Only show streaming text if user hasn't switched sessions */
        if (activeChatIdRef.current === sessionId) {
          setStreamingText(accumulated);
        }
      }, controller.signal, activeQuarter);

      /* Commit the complete message and clear the streaming buffer */
      if (activeChatIdRef.current === sessionId) {
        const rawText = accumulated || "I wasn't able to generate a response. Please try again.";
        const finalText = stripNextStepsSentinel(rawText);
        const finalMsg: ChatMsg = { role: "ai", text: finalText };
        if (meta.matchedTeachers?.length) finalMsg.matchedTeachers = meta.matchedTeachers;
        if (meta.nextSteps?.length) finalMsg.nextSteps = meta.nextSteps;
        setChatMsgs((prev) => [...prev, finalMsg]);
        setStreamingText("");
      }

      const now = new Date().toISOString();
      queryClient.setQueryData<AIChatSession[]>(["chatSessions"], (prev = []) =>
        [...prev.map((s) => s.id === sessionId ? { ...s, updatedAt: now } : s)]
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      );
      queryClient.invalidateQueries({ queryKey: ["chatMessages", sessionId] });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setChatTyping(false);
      setStreamingText("");
      /* Only show error in the chat that sent the message */
      if (activeChatIdRef.current === sentForSession) {
        setChatMsgs((prev) => [
          ...prev,
          { role: "ai", text: "Sorry, I couldn't retrieve a response right now. Please try again." },
        ]);
      }
    } finally {
      setChatTyping(false);
      abortControllerRef.current = null;
      /* streamingText is cleared above in both success and error paths */
    }
  }

  async function handleInstantAnalysis() {
    if (isInstantAnalyzing) return;
    setIsInstantAnalyzing(true);
    let capturedSessionId: number | null = null;
    try {
      const sessionTitle = `${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} Instant Analysis`;
      const newSession = await createChatSession(sessionTitle);
      const sessionId = newSession.id;
      capturedSessionId = sessionId;

      setActiveChatId(newSession.id);
      activeChatIdRef.current = newSession.id;
      queryClient.setQueryData<AIChatSession[]>(["chatSessions"], (prev = []) => [newSession, ...prev]);
      setChatMsgs([]);
      setChatTyping(true);
      setStreamingText("");

      /* Fetch the full narrative (persisted to the session via sessionId) */
      const result = await generateAIAnalysis(activeQuarter, schoolId, sessionId);
      const { structured } = result;

      /* Show the structured card immediately (no streaming — it's a component, not text) */
      if (activeChatIdRef.current === sessionId) {
        setChatTyping(false);
        setChatMsgs([{ role: "ai", text: structured.narrativeForContext, instantAnalysis: structured }]);
        setStreamingText("");
      }

      const now = new Date().toISOString();
      queryClient.setQueryData<AIChatSession[]>(["chatSessions"], (prev = []) =>
        [...prev.map((s) => s.id === sessionId ? { ...s, updatedAt: now } : s)]
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      );
      queryClient.invalidateQueries({ queryKey: ["chatMessages", capturedSessionId!] });
    } catch (err) {
      setChatTyping(false);
      setStreamingText("");
      if (capturedSessionId === null || activeChatIdRef.current === capturedSessionId) {
        const msg = err instanceof Error && err.message
          ? err.message
          : "Sorry, I couldn't generate the analysis right now. Please try again.";
        setChatMsgs([{ role: "ai", text: msg }]);
      }
    } finally {
      setIsInstantAnalyzing(false);
    }
  }

  async function handleRenameSubmit(id: number) {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    try {
      const updated = await renameChatSession(id, renameValue.trim());
      queryClient.setQueryData<AIChatSession[]>(["chatSessions"], (prev = []) => prev.map((s) => s.id === id ? { ...s, title: updated.title } : s));
    } catch { /* silent */ }
    setRenamingId(null);
  }

  async function handleDeleteChat(id: number) {
    try {
      await deleteChatSession(id);
      const remaining = sessions.filter((s) => s.id !== id);
      queryClient.setQueryData<AIChatSession[]>(["chatSessions"], remaining);
      setDeleteConfirmId(null);
      if (activeChatIdRef.current === id) {
        if (remaining.length > 0) {
          await selectSession(remaining[0].id);
        } else {
          setActiveChatId(null);
          activeChatIdRef.current = null;
          setChatMsgs([]);
        }
      }
    } catch { /* silent */ }
  }

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1)  return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7)  return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  /* ── Render ─────────────────────────────────────────── */
  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* Tabs wraps everything so TabsList can live inside the sticky bar */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 overflow-hidden flex flex-col">

        {/* ── Frozen top bar (header + tab nav) ── */}
        <div className="sticky top-0 z-30 flex flex-col shadow-md">

          {currentUser && (
            <AppHeader
              subtitle="Action Center"
              backHref={returnTo}
              backLabel="Back to Dashboard"
              draftsHref={`${baseUrl}/drafts${schoolId != null ? `?schoolId=${schoolId}&schoolName=${encodeURIComponent(schoolNameFromUrl)}&schoolAbbreviation=${encodeURIComponent(schoolAbbreviation ?? "")}` : schoolAbbreviation ? `?schoolAbbreviation=${encodeURIComponent(schoolAbbreviation)}` : ""}`}
              basePath={baseUrl}
              actionCenterHref={`${baseUrl}/action-center${searchParams.toString() ? `?${searchParams.toString()}` : ""}`}
              schoolAbbreviation={schoolAbbreviation}
              userName={currentUser.name}
              userRole={currentUser.role}
              canAdmin={currentUser.role !== "COACH"}
              onAddObservation={() => handleAddObsClick("")}
              rubricSets={quarters.filter((q) => q.target === "TEACHER").map((q) => ({ slug: q.slug, name: q.name, target: q.target, subjectAudience: q.subjectAudience }))}
              activeRubricSet={activeQuarter}
              onRubricChange={(slug) => {
                const sp = new URLSearchParams(window.location.search);
                sp.set("rubric", slug);
                window.location.replace(`${window.location.pathname}?${sp.toString()}`);
              }}
            />
          )}

          {/* Tab bar */}
          <div className="bg-white border-b border-slate-200 px-4 sm:px-6">
            <TabsList className="h-auto bg-transparent gap-0 p-0 rounded-none">
              {[
                { value: "summary",      label: "Summary",       icon: <BarChart2   size={15} /> },
                { value: "intervention", label: "Intervention",  icon: <Activity    size={15} /> },
                ...(currentUser?.role === "NETWORK_ADMIN"
                  ? [
                      { value: "analysis",        label: "Data Assistant",              icon: <Sparkles  size={15} /> },
                      { value: "report-generator", label: "Walkthrough Report Generator", icon: <FileText size={15} /> },
                    ]
                  : []),
              ].map(({ value, label, icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="flex items-center gap-2 px-4 sm:px-5 py-3.5 text-sm font-semibold text-slate-500 border-b-2 border-transparent rounded-none bg-transparent transition-colors
                    data-[state=active]:text-[#1034B4] data-[state=active]:border-[#1034B4] data-[state=active]:bg-transparent
                    hover:text-slate-700"
                >
                  {icon}
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">{label.split(" ")[0]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>{/* end sticky top bar */}

          {/* ═══════════════════════════════════════════════════
              TAB 1 — SCHOOL-WIDE SUMMARY
          ════════════════════════════════════════════════════ */}
          <TabsContent value="summary" className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6 mt-0">

            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-3 min-h-[60px] flex flex-col justify-center">
                  <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY }}>
                    <BarChart2 size={17} style={{ color: YELLOW }} /> Current School Average
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  <div className="flex items-end gap-3">
                    <span
                      className="text-2xl font-bold tabular-nums leading-tight"
                      style={{ color: schoolAvg !== null ? (schoolAvg >= PROFICIENCY_THRESHOLD ? "#16a34a" : "#dc2626") : "#94a3b8",
                               fontFamily: "'Bebas Neue', sans-serif" }}
                    >
                      {schoolAvg !== null ? schoolAvg.toFixed(2) : "—"}
                    </span>
                    {schoolAvg !== null && (
                      <Badge
                        className="mb-1 text-xs font-bold px-2 py-0.5"
                        style={{
                          backgroundColor: schoolAvg >= PROFICIENCY_THRESHOLD ? "#DCFCE7" : "#FEE2E2",
                          color: schoolAvg >= PROFICIENCY_THRESHOLD ? "#15803D" : "#B91C1C",
                          border: "none",
                        }}
                      >
                        {schoolAvg >= PROFICIENCY_THRESHOLD ? "Proficient" : "Not Proficient"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 mt-1">Across all domains, most recent observations</p>
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-3 min-h-[60px] flex flex-col justify-center">
                  <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY }}>
                    <TrendingUp size={17} style={{ color: YELLOW }} /> Highest Domain
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {insights?.topStrength ? (
                    <>
                      <p className="text-2xl font-bold leading-tight" style={{ color: "#15803D", fontFamily: "'Bebas Neue', sans-serif" }}>
                        {insights.topStrength.domain}
                      </p>
                      <p className="text-sm text-slate-600 mt-1">
                        Avg score <span className="font-bold text-green-700">{insights.topStrength.avg.toFixed(2)}</span> across {insights.topStrength.count} observation{insights.topStrength.count !== 1 ? "s" : ""}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-slate-300" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>—</p>
                      <p className="text-sm text-slate-500 mt-1">No observation data yet</p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-3 min-h-[60px] flex flex-col justify-center">
                  <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY }}>
                    <TrendingDown size={17} style={{ color: YELLOW }} /> Lowest Domain
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {insights?.topGrowth ? (
                    <>
                      <p className="text-2xl font-bold leading-tight" style={{ color: "#B91C1C", fontFamily: "'Bebas Neue', sans-serif" }}>
                        {insights.topGrowth.domain}
                      </p>
                      <p className="text-sm text-slate-600 mt-1">
                        Avg score <span className="font-bold text-red-700">{insights.topGrowth.avg.toFixed(2)}</span> across {insights.topGrowth.count} observation{insights.topGrowth.count !== 1 ? "s" : ""}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-slate-300" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>—</p>
                      <p className="text-sm text-slate-500 mt-1">No observation data yet</p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Qualitative Trends ────────────────────────────── */}
            {(() => {
              const effectiveSchoolId = schoolId ?? (currentUser?.schoolId ?? null);
              return effectiveSchoolId != null && rubricFromUrl ? (
                <QualitativeThemesCard
                  schoolId={effectiveSchoolId}
                  rubricSlug={rubricFromUrl}
                  basePath={baseUrl}
                />
              ) : null;
            })()}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

              {/* ── Domain Comparison — left two thirds ───────────── */}
              <Card className="lg:col-span-2 border-slate-200 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY }}>
                      <BarChart2 size={17} style={{ color: YELLOW }} />
                      Domain Comparison
                    </CardTitle>
                    {/* Segmentation toggle */}
                    <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ backgroundColor: "#f1f5f9" }}>
                      {([
                        { key: "school", label: "School" },
                        { key: "dept",   label: "By Dept" },
                        { key: "grade",  label: "By Grade" },
                      ] as { key: "school" | "dept" | "grade"; label: string }[]).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setDomainSeg(key)}
                          className="px-3 py-1.5 text-xs font-semibold rounded-md transition-all"
                          style={{
                            backgroundColor: domainSeg === key ? "white" : "transparent",
                            color:           domainSeg === key ? NAVY : "#64748b",
                            boxShadow:       domainSeg === key ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {!domainCompData ? (
                    <p className="text-sm text-slate-400 italic text-center py-6">No observation data yet.</p>
                  ) : domainSeg === "school" ? (
                    /* ── School view: proper table with bar column ─── */
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ backgroundColor: NAVY }}>
                            {["Domain", "Score", ""].map((h, i) => (
                              <th key={i} className={`px-4 py-2.5 text-white font-bold uppercase tracking-wider text-sm${i > 0 ? " text-right" : " text-left"}`}
                                style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", width: i === 1 ? 56 : i === 2 ? "40%" : undefined }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                          <tr style={{ height: 3, backgroundColor: YELLOW }}><td colSpan={3} style={{ padding: 0, height: 3 }} /></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {domainCompData.sortedDomains.map((d) => {
                            const avg    = domainCompData.schoolAvgs[d.id];
                            const color  = avg === null ? "#94a3b8" : avg >= PROFICIENCY_THRESHOLD ? "#15803d" : avg >= WARNING_THRESHOLD ? "#b45309" : "#b91c1c";
                            const fillBg = avg === null ? "#cbd5e1" : avg >= PROFICIENCY_THRESHOLD ? "#16a34a" : avg >= WARNING_THRESHOLD ? "#d97706" : "#dc2626";
                            return (
                              <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-2.5 text-slate-700 text-sm font-medium">{d.label}</td>
                                <td className="px-4 py-2.5 text-right">
                                  <span className="font-bold tabular-nums text-sm" style={{ color }}>
                                    {avg !== null ? avg.toFixed(2) : "—"}
                                  </span>
                                </td>
                                <td className="pr-4 py-2.5">
                                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full rounded-full transition-all" style={{ width: `${(avg ?? 0) * 100}%`, backgroundColor: fillBg }} />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    /* ── By Dept / By Grade: proper table ─── */
                    (() => {
                      const segments = domainSeg === "dept" ? domainCompData.depts : domainCompData.grades;
                      const segAvgs  = domainSeg === "dept" ? domainCompData.deptAvgs : domainCompData.gradeAvgs;
                      const segLabel = domainSeg === "dept" ? "Subject" : "Grade";

                      function scoreCell(val: number | null | undefined, schoolAvg: number | null | undefined) {
                        if (val === null || val === undefined) return <span className="text-slate-300">—</span>;
                        const isGap = schoolAvg !== null && schoolAvg !== undefined && (schoolAvg - val) >= 0.3;
                        const clr   = val >= PROFICIENCY_THRESHOLD ? "#15803d" : val >= WARNING_THRESHOLD ? "#92400e" : "#b91c1c";
                        return (
                          <span className="font-bold tabular-nums text-xs" style={{ color: isGap ? "#dc2626" : clr }}>
                            {isGap && <span className="mr-0.5 text-red-500">▼</span>}
                            {val.toFixed(2)}
                          </span>
                        );
                      }

                      return (
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full text-xs">
                            <thead>
                              <tr style={{ backgroundColor: NAVY }}>
                                <th className="text-left px-4 py-2.5 text-white font-bold uppercase tracking-wider text-sm"
                                  style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", minWidth: 120 }}>Domain</th>
                                <th className="px-3 py-2.5 text-white font-bold uppercase tracking-wider text-sm text-center"
                                  style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", minWidth: 52 }}>School</th>
                                {segments.map((s) => (
                                  <th key={s} className="px-3 py-2.5 text-white font-bold uppercase tracking-wider text-sm text-center"
                                    style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", minWidth: 52 }}
                                    title={`${segLabel}: ${s}`}>
                                    {domainSeg === "grade" ? `Gr ${s}` : s.length > 7 ? s.slice(0, 6) + "…" : s}
                                  </th>
                                ))}
                              </tr>
                              <tr style={{ height: 3, backgroundColor: YELLOW }}>
                                <td colSpan={2 + segments.length} style={{ padding: 0, height: 3 }} />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {domainCompData.sortedDomains.map((d) => {
                                const schoolAvg = domainCompData.schoolAvgs[d.id];
                                return (
                                  <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-2.5 text-slate-700 font-medium text-xs truncate" style={{ maxWidth: 130 }} title={d.label}>{d.label}</td>
                                    <td className="px-3 py-2.5 text-center">{scoreCell(schoolAvg, undefined)}</td>
                                    {segments.map((s) => (
                                      <td key={s} className="px-3 py-2.5 text-center">{scoreCell(segAvgs[s]?.[d.id], schoolAvg)}</td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()
                  )}
                  {/* Footer */}
                  {domainCompData && (
                    <p className="text-xs text-slate-400 mt-3 px-5 pt-3 border-t border-slate-100">
                      <span className="font-semibold text-slate-500">{domainCompData.belowThreshold}</span> of{" "}
                      <span className="font-semibold text-slate-500">{allDomains.length}</span> domains below proficiency ({PROFICIENCY_THRESHOLD})
                      {domainSeg !== "school" && (
                        <span className="ml-2 text-red-500">· ▼ = gap ≥ 0.3 below school avg</span>
                      )}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* ── Network Comparison — right half ───────────────── */}
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY }}>
                      <Globe2 size={17} style={{ color: YELLOW }} />
                      Network Comparison
                    </CardTitle>
                    {/* spacer — matches toggle pill height in Domain Comparison header */}
                    <div className="h-8" />
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {!networkCompData || !domainCompData ? (
                    <p className="text-sm text-slate-400 italic text-center py-6">Network data unavailable.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-xs">
                          <thead>
                            <tr style={{ backgroundColor: NAVY }}>
                              {["Domain", "School", "Network", "Δ"].map((h, i) => (
                                <th key={i}
                                  className={`py-2.5 text-white font-bold uppercase tracking-wider text-sm${i === 0 ? " text-left px-4" : " text-center px-3"}`}
                                  style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", minWidth: i === 0 ? 90 : 44 }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                            <tr style={{ height: 3, backgroundColor: YELLOW }}>
                              <td colSpan={4} style={{ padding: 0, height: 3 }} />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {domainCompData.sortedDomains.map((d) => {
                              const schoolVal  = domainCompData.schoolAvgs[d.id];
                              const networkVal = networkCompData.networkAvgs[d.id];
                              const delta      = schoolVal !== null && networkVal !== null ? schoolVal - networkVal : null;
                              const schoolClr  = schoolVal  === null ? "#94a3b8" : schoolVal  >= PROFICIENCY_THRESHOLD ? "#15803d" : schoolVal  >= WARNING_THRESHOLD ? "#92400e" : "#b91c1c";
                              const networkClr = networkVal === null ? "#94a3b8" : networkVal >= PROFICIENCY_THRESHOLD ? "#15803d" : networkVal >= WARNING_THRESHOLD ? "#92400e" : "#b91c1c";
                              const deltaClr   = delta === null ? "#94a3b8" : delta > 0.02 ? "#15803d" : delta < -0.02 ? "#b91c1c" : "#64748b";
                              const deltaLabel = delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`;
                              return (
                                <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-4 py-2.5 text-slate-700 font-medium text-xs truncate" style={{ maxWidth: 100 }} title={d.label}>{d.label}</td>
                                  <td className="px-3 py-2.5 text-center font-bold tabular-nums" style={{ color: schoolClr }}>
                                    {schoolVal !== null ? schoolVal.toFixed(2) : "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-center font-bold tabular-nums text-slate-500">
                                    <span style={{ color: networkClr }}>{networkVal !== null ? networkVal.toFixed(2) : "—"}</span>
                                  </td>
                                  <td className="px-3 py-2.5 text-center font-bold tabular-nums" style={{ color: deltaClr }}>{deltaLabel}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-slate-400 mt-3 px-4 pt-3 border-t border-slate-100">
                        Δ = school minus network · <span className="text-green-700 font-semibold">+above</span> / <span className="text-red-600 font-semibold">−below</span>
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

            </div>


          </TabsContent>

          {/* ═══════════════════════════════════════════════════
              TAB 2 — INTERVENTION WORKFLOWS
          ════════════════════════════════════════════════════ */}
          <TabsContent value="intervention" className="flex-1 flex flex-col overflow-hidden mt-0">

            {/* ── Secondary sub-tab bar ─────────────────────── */}
            <div style={{ backgroundColor: "white", borderBottom: "1px solid #e2e8f0" }} className="px-4 sm:px-6 flex gap-6">
              {(
                [
                  { key: "rescore",     label: "Rescore Queue",       count: queue.length },
                  { key: "overdue",     label: "Overdue Observations", count: overdueTeachers.length },
                  ...(currentUser?.role !== "COACH"
                    ? [{ key: "calibration", label: "Calibration Flags", count: calibrationFlags.length }]
                    : []),
                  { key: "overdueActionSteps", label: "Overdue Action Steps", count: overdueActionSteps.length },
                ] as { key: "rescore" | "overdue" | "calibration" | "overdueActionSteps"; label: string; count: number }[]
              ).map(({ key, label, count }) => {
                const active = interventionTab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setInterventionTab(key)}
                    className="flex items-center gap-2 py-3 text-sm font-semibold transition-colors"
                    style={{
                      color:        active ? NAVY : "#64748b",
                      borderBottom: active ? `2px solid ${YELLOW}` : "2px solid transparent",
                      marginBottom: -1,
                    }}
                  >
                    {label}
                    {count > 0 && (
                      <span
                        style={{
                          display:         "flex",
                          alignItems:      "center",
                          justifyContent:  "center",
                          backgroundColor: "#DC2626",
                          color:           "white",
                          fontSize:        11,
                          fontWeight:      700,
                          width:           20,
                          height:          20,
                          borderRadius:    "50%",
                          lineHeight:      1,
                          flexShrink:      0,
                        }}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Sub-tab content ───────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">

              {/* RESCORE QUEUE */}
              {interventionTab === "rescore" && (
                <section>
                  <div className="mb-4">
                    <h2 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em" }}>
                      Walkthrough Rescore Queue
                    </h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                      Teachers who received a walkthrough score below {PROFICIENCY_THRESHOLD} and require a rescore within 14 days.
                    </p>
                  </div>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-14">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: NAVY }} />
                    </div>
                  ) : isError ? (
                    <div className="text-center py-14 text-red-500 font-semibold">Failed to load rescore queue. Please refresh.</div>
                  ) : queue.length === 0 ? (
                    <Card className="border-slate-200 shadow-sm flex flex-col items-center justify-center py-14 gap-3">
                      <CheckCircle2 size={48} className="text-green-400" />
                      <div className="text-center">
                        <p className="font-bold text-lg" style={{ color: NAVY }}>All clear!</p>
                        <p className="text-slate-500 text-sm mt-1">No teachers currently require rescoring.</p>
                      </div>
                    </Card>
                  ) : (
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ backgroundColor: NAVY }}>
                              {["Teacher", "School", "Subject / Grade", "Due Date", "Status", ""].map((h, i) => (
                                <th key={i} className="text-left px-4 py-3 text-white font-bold uppercase tracking-wider text-base" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>{h}</th>
                              ))}
                            </tr>
                            <tr style={{ height: 3, backgroundColor: YELLOW }}><td colSpan={6} style={{ padding: 0, height: 3 }} /></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {queue.map((item) => {
                              const status = getDueStatus(item.rescoreDueDate);
                              return (
                                <tr key={item.employeeId} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-4 py-3 font-semibold">
                                    <a href={`${baseUrl}/?teacher=${item.employeeId}`} className="hover:underline underline-offset-2" style={{ color: NAVY }}>{item.teacherName}</a>
                                  </td>
                                  <td className="px-4 py-3 text-slate-600">{item.schoolName ?? "—"}</td>
                                  <td className="px-4 py-3 text-slate-600">
                                    {item.department}<span className="text-slate-400 ml-1.5">{item.gradeLevel.length > 0 ? `· Gr. ${item.gradeLevel.join(", ")}` : ""}</span>
                                  </td>
                                  <td className="px-4 py-3 text-slate-600">
                                    {item.rescoreDueDate ? new Date(item.rescoreDueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="inline-flex items-center gap-1.5 font-bold px-2.5 py-1 rounded-full text-xs" style={{ backgroundColor: status.urgent ? "#FEF2F2" : "#F0FDF4", color: status.color }}>
                                      <Clock size={12} />{status.label}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <button onClick={() => handleAddObsClick(item.employeeId, true)} className="inline-flex items-center gap-1.5 font-bold px-3 py-1.5 rounded-md text-xs transition-colors hover:opacity-90" style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.03em", fontSize: 13 }}>
                                      <Plus size={13} /> Score Rescore
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* OVERDUE OBSERVATIONS */}
              {interventionTab === "overdue" && (
                <section>
                  <div className="mb-4">
                    <h2 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em" }}>
                      Overdue Observations
                    </h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                      Teachers who have not been observed in the last 14 days.
                    </p>
                  </div>
                  {overdueTeachers.length === 0 ? (
                    <Card className="border-slate-200 shadow-sm flex flex-col items-center justify-center py-10 gap-3">
                      <CheckCircle2 size={40} className="text-green-400" />
                      <div className="text-center">
                        <p className="font-bold text-base" style={{ color: NAVY }}>All teachers observed recently</p>
                        <p className="text-slate-500 text-sm mt-1">No one is overdue for an observation.</p>
                      </div>
                    </Card>
                  ) : (
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ backgroundColor: NAVY }}>
                              {["Teacher", "Subject / Grade", "Last Observed", "Days Since", ""].map((h, i) => (
                                <th key={i} className="text-left px-4 py-3 text-white font-bold uppercase tracking-wider text-base" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>{h}</th>
                              ))}
                            </tr>
                            <tr style={{ height: 3, backgroundColor: YELLOW }}><td colSpan={5} style={{ padding: 0, height: 3 }} /></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {overdueTeachers.map((t) => {
                              const subjectGrade = [t.subject, t.gradeLevel].filter(Boolean).join(" · ") || "—";
                              const daysLabel = t.daysSince === null ? "Never" : `${t.daysSince}d ago`;
                              const urgency = t.daysSince === null || t.daysSince > 30 ? { bg: "#FEF2F2", color: "#991B1B" } : { bg: "#FEF3C7", color: "#92400E" };
                              return (
                                <tr key={t.employeeId} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-4 py-3 font-semibold text-slate-700">{t.teacherName}</td>
                                  <td className="px-4 py-3 text-slate-600">{subjectGrade}</td>
                                  <td className="px-4 py-3 text-slate-600">
                                    {t.lastObserved ? new Date(t.lastObserved).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : <span className="text-slate-400 italic">No observations</span>}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="inline-flex items-center font-bold px-2.5 py-1 rounded-full text-xs" style={{ backgroundColor: urgency.bg, color: urgency.color }}>{daysLabel}</span>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <button onClick={() => handleAddObsClick(t.employeeId)} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded transition-colors" style={{ backgroundColor: NAVY, color: "white" }}>
                                      <Plus size={13} /> Observe Now
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* OVERDUE ACTION STEPS */}
              {interventionTab === "overdueActionSteps" && (
                <section>
                  <div className="mb-4">
                    <h2 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em" }}>
                      Overdue Action Steps
                    </h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                      Action steps that have passed their due date and have not yet been mastered.
                    </p>
                  </div>
                  {overdueActionSteps.length === 0 ? (
                    <Card className="border-slate-200 shadow-sm flex flex-col items-center justify-center py-14 gap-3">
                      <CheckCircle2 size={48} className="text-green-400" />
                      <div className="text-center">
                        <p className="font-bold text-lg" style={{ color: NAVY }}>All clear!</p>
                        <p className="text-slate-500 text-sm mt-1">No overdue action steps at this time.</p>
                      </div>
                    </Card>
                  ) : (
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ backgroundColor: NAVY }}>
                              {["Teacher", "School", "Action Step", "Due Date", "Days Overdue", "Assigned By"].map((h, i) => (
                                <th key={i} className="text-left px-4 py-3 text-white font-bold uppercase tracking-wider text-base" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>{h}</th>
                              ))}
                            </tr>
                            <tr style={{ height: 3, backgroundColor: YELLOW }}><td colSpan={6} style={{ padding: 0, height: 3 }} /></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {overdueActionSteps.map((item) => (
                              <tr
                                key={item.id}
                                className="hover:bg-slate-50 transition-colors cursor-pointer"
                                onClick={() => navigate(`${baseUrl}/teacher/${item.teacherEmployeeId}?name=${encodeURIComponent(item.teacherName)}`)}
                              >
                                <td className="px-4 py-3 font-semibold" style={{ color: NAVY }}>
                                  {item.teacherName}
                                </td>
                                <td className="px-4 py-3 text-slate-600">{item.schoolName ?? "—"}</td>
                                <td className="px-4 py-3 text-slate-700 max-w-xs">
                                  <p className="line-clamp-2 leading-snug">{item.text}</p>
                                </td>
                                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                                  {new Date(item.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex items-center font-bold px-2.5 py-1 rounded-full text-xs" style={{ backgroundColor: "#FEE2E2", color: "#B91C1C" }}>
                                    {item.daysOverdue}d overdue
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-slate-600">{item.assignerName ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* CALIBRATION FLAGS */}
              {interventionTab === "calibration" && currentUser?.role !== "COACH" && (
                <section>
                  <div className="mb-4">
                    <h2 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em" }}>
                      Calibration Flags
                    </h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                      School-based coaches whose scores diverge ≥ 0.5 pts from the network's score on the same teachers — a sign their lens may not be calibrated to the network bar.
                    </p>
                  </div>
                  {calibrationFlags.length === 0 ? (
                    <Card className="border-slate-200 shadow-sm flex flex-col items-center justify-center py-10 gap-3">
                      <CheckCircle2 size={40} className="text-green-400" />
                      <div className="text-center">
                        <p className="font-bold text-base" style={{ color: NAVY }}>No calibration discrepancies</p>
                        <p className="text-slate-500 text-sm mt-1">School Coach and Network Walkthrough scores are aligned.</p>
                      </div>
                    </Card>
                  ) : (
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ backgroundColor: NAVY }}>
                              {["Coach", "Domain", "Coach Score", "Network Score", "Delta"].map((h, i) => (
                                <th key={i} className="text-left px-4 py-3 text-white font-bold uppercase tracking-wider text-base" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>{h}</th>
                              ))}
                            </tr>
                            <tr style={{ height: 3, backgroundColor: YELLOW }}><td colSpan={5} style={{ padding: 0, height: 3 }} /></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {calibrationFlags.map((flag, i) => (
                              <tr key={i} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-3 font-semibold text-slate-700">{flag.teacher ?? flag.school ?? "—"}</td>
                                <td className="px-4 py-3 text-slate-600">{flag.domain}</td>
                                <td className="px-4 py-3 font-bold" style={{ color: NAVY }}>{flag.schoolScore.toFixed(1)}</td>
                                <td className="px-4 py-3 font-bold text-amber-700">{flag.networkScore.toFixed(1)}</td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex items-center font-bold px-2.5 py-1 rounded-full text-xs" style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}>
                                    Δ {flag.delta.toFixed(1)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>
              )}

            </div>
          </TabsContent>

          {/* ═══════════════════════════════════════════════════
              TAB 3 — ANALYSIS (unified chat)
          ════════════════════════════════════════════════════ */}
          <TabsContent value="analysis" className="flex-1 flex overflow-hidden mt-0 relative">

            {/* Mobile backdrop — closes sidebar when tapping outside */}
            {mobileSidebarOpen && (
              <div
                className="absolute inset-0 bg-black/30 z-20 md:hidden"
                onClick={() => setMobileSidebarOpen(false)}
              />
            )}

            {/* ── Left Sidebar ── */}
            <div
              className={[
                "flex flex-col shrink-0 overflow-hidden bg-white",
                "absolute md:relative inset-y-0 left-0 z-30 h-full",
                "transition-transform duration-200 ease-in-out",
                mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
              ].join(" ")}
              style={{ width: 256, borderRight: "1px solid #e2e8f0" }}
            >
              {/* New Chat button */}
              <div className="p-4" style={{ borderBottom: "1px solid #e2e8f0" }}>
                <button
                  onClick={handleNewChat}
                  className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 font-bold transition-opacity hover:opacity-90"
                  style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.04em" }}
                >
                  <Plus size={14} /> New Chat
                </button>
              </div>

              {/* Session list */}
              <div className="flex-1 overflow-y-auto">
                {sessionsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2" style={{ borderColor: NAVY }} />
                  </div>
                ) : sessions.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-slate-400 leading-relaxed" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
                    No chats yet. Ask a question or run an Instant Analysis to begin.
                  </p>
                ) : (
                  sessions.map((s) => {
                    const isActive   = s.id === activeChatId;
                    const isRenaming = renamingId === s.id;
                    const isConfirm  = deleteConfirmId === s.id;
                    return (
                      <div
                        key={s.id}
                        className="group relative flex flex-col cursor-pointer"
                        style={{
                          padding:         "10px 14px",
                          borderBottom:    "1px solid #f1f5f9",
                          borderLeft:      `3px solid ${isActive ? YELLOW : "transparent"}`,
                          backgroundColor: isActive ? "#EEF2FF" : "transparent",
                          transition:      "background-color 0.1s",
                        }}
                        onClick={() => { if (!isRenaming && !isConfirm) selectSession(s.id); }}
                        onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.backgroundColor = "#f8fafc"; }}
                        onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}
                      >
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => handleRenameSubmit(s.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRenameSubmit(s.id);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="w-full font-semibold bg-white rounded px-2 py-1 border border-slate-300 focus:outline-none"
                            style={{ color: NAVY, fontFamily: "'Libre Franklin', sans-serif", fontSize: 14 }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : isConfirm ? (
                          <div onClick={(e) => e.stopPropagation()}>
                            <p className="text-xs font-semibold mb-2" style={{ color: "#b91c1c" }}>Delete this chat?</p>
                            <div className="flex gap-2">
                              <button
                                className="text-xs font-bold px-2 py-1 rounded text-white"
                                style={{ backgroundColor: "#dc2626" }}
                                onClick={() => handleDeleteChat(s.id)}
                              >Delete</button>
                              <button
                                className="text-xs font-semibold px-2 py-1 rounded border border-slate-200 text-slate-600"
                                onClick={() => setDeleteConfirmId(null)}
                              >Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span
                              className="font-semibold truncate leading-snug"
                              style={{
                                fontFamily:  "'Libre Franklin', sans-serif",
                                color:       isActive ? NAVY : "#374151",
                                paddingRight: 36,
                                fontSize:    14,
                              }}
                              title={s.title}
                            >{s.title}</span>
                            <span className="text-xs mt-0.5" style={{ color: "#94a3b8", fontFamily: "'Libre Franklin', sans-serif" }}>{relativeTime(s.updatedAt)}</span>
                            <div className="absolute right-2 top-2 hidden group-hover:flex items-center gap-0.5">
                              <button
                                className="p-1 rounded transition-colors hover:bg-slate-200"
                                title="Rename"
                                onClick={(e) => { e.stopPropagation(); setRenamingId(s.id); setRenameValue(s.title); }}
                              >
                                <Pencil size={11} style={{ color: "#94a3b8" }} />
                              </button>
                              <button
                                className="p-1 rounded transition-colors hover:bg-red-100"
                                title="Delete"
                                onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(s.id); }}
                              >
                                <Trash2 size={11} style={{ color: "#f87171" }} />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* ── Main Chat Area ── */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ backgroundColor: "#F4F6FB" }}>

              {/* Mobile sidebar toggle — only visible on narrow screens */}
              <div className="flex items-center md:hidden px-3 pt-3 shrink-0">
                <button
                  onClick={() => setMobileSidebarOpen((o) => !o)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors"
                  style={{ backgroundColor: "white", color: NAVY, border: "1px solid #e2e8f0" }}
                  aria-label="Toggle chat history"
                >
                  {mobileSidebarOpen ? <X size={14} /> : <PanelLeft size={14} />}
                  {mobileSidebarOpen ? "Close" : "Chats"}
                </button>
              </div>

              {activeChatId === null ? (
                /* ── Empty state ── */
                <div className="flex-1 flex flex-col items-center justify-center px-3 py-10">
                  <div className="w-full max-w-xl">
                    <div className="text-center mb-5">
                      <h2
                        className="font-bold uppercase tracking-wide mb-1"
                        style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em", fontSize: 28 }}
                      >
                        Catalyst Data Assistant
                      </h2>
                      <p className="text-sm text-slate-500" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
                        Ask anything about your teachers, scores, and coaching priorities.
                      </p>
                    </div>

                    {/* Input + Send */}
                    <div className="flex gap-2 mb-4 items-end">
                      <textarea
                        ref={chatTextareaRef}
                        value={chatInput}
                        rows={1}
                        onChange={(e) => {
                          setChatInput(e.target.value);
                          const el = e.target;
                          el.style.height = "auto";
                          el.style.height = Math.min(el.scrollHeight, 120) + "px";
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                        placeholder="Ask about your school's observation data…"
                        className="flex-1 rounded-xl border border-slate-200 bg-white shadow-sm text-sm px-3 py-3 resize-none focus:outline-none focus:ring-1"
                        style={{
                          minHeight: 48,
                          maxHeight: 120,
                          overflowY: "auto",
                          lineHeight: "1.5",
                          fontFamily: "inherit",
                          '--tw-ring-color': NAVY,
                        } as React.CSSProperties}
                      />
                      <Button
                        onClick={() => handleSendChat()}
                        disabled={!chatInput.trim()}
                        className="h-12 px-5 rounded-xl shadow-sm shrink-0"
                        style={{ backgroundColor: NAVY }}
                      >
                        <Send size={18} color="white" />
                      </Button>
                    </div>

                    {/* Instant Analysis */}
                    <div className="flex flex-col items-center gap-3 mb-4">
                      <button
                        onClick={handleInstantAnalysis}
                        disabled={isInstantAnalyzing}
                        className="flex items-center gap-2 rounded-xl px-6 py-2.5 font-bold transition-opacity disabled:opacity-60 hover:opacity-90"
                        style={{ backgroundColor: YELLOW, color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.04em" }}
                      >
                        {isInstantAnalyzing ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        {isInstantAnalyzing ? "Generating Analysis…" : "Instant Analysis"}
                      </button>
                      <p className="text-xs text-slate-400 text-center" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
                        {isInstantAnalyzing
                          ? <span className="animate-pulse">Reviewing your school's rubric data — this may take a moment</span>
                          : "Scans all your observation data and surfaces key strengths, flags, and coaching priorities — all grounded in your live observation data."}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                /* ── Active chat view ── */
                <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 sm:px-6 py-5 min-h-0">

                  {/* Header */}
                  <div className="flex items-center gap-2 mb-3 shrink-0 pb-3" style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <h2
                      className="font-semibold"
                      style={{ fontFamily: "'Libre Franklin', sans-serif", color: NAVY, fontSize: 14 }}
                    >
                      {sessions.find((s) => s.id === activeChatId)?.title ?? "Chat"}
                    </h2>
                    <Badge className="ml-auto text-xs font-bold px-2 py-0.5" style={{ backgroundColor: "#DCFCE7", color: "#15803D", border: "none" }}>
                      Live Data
                    </Badge>
                  </div>

                  {/* Message area */}
                  <ScrollArea className="flex-1 min-h-0 pr-1">
                    <div className="space-y-4 pb-2">
                      {chatMsgs.map((msg, i) =>
                        msg.instantAnalysis ? (
                          <InstantAnalysisCard
                            key={i}
                            structured={msg.instantAnalysis}
                            onChipClick={(text) => handleSendChat(text)}
                            onSummaryTabClick={() => setActiveTab("summary")}
                          />
                        ) : (
                          <div key={i} className={`flex items-start gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                            <div className="max-w-[80%] flex flex-col gap-1.5">
                              <div
                                className="px-4 py-2.5 text-sm leading-relaxed"
                                style={{
                                  backgroundColor: msg.role === "ai" ? "white" : "#EEF2FB",
                                  color:           "#1e293b",
                                  border:          msg.role === "ai" ? "1px solid #e2e8f0" : "none",
                                  borderRadius:    "12px",
                                  boxShadow:       "none",
                                  position:        "relative",
                                  paddingRight:    msg.role === "ai" ? 42 : undefined,
                                }}
                              >
                                {msg.role === "ai" && (
                                  <div style={{ position: "absolute", top: 6, right: 8 }}>
                                    <div style={{ position: "relative", display: "inline-block" }}>
                                      <button
                                        onClick={() => {
                                          const plain = msg.text
                                            .replace(/\*\*(.+?)\*\*/g, "$1")
                                            .replace(/^#+\s+/gm, "")
                                            .replace(/\r?\n{3,}/g, "\n\n")
                                            .trim();
                                          const doSuccess = () => {
                                            setCopiedMsgIdx(i);
                                            setTimeout(() => setCopiedMsgIdx(null), 2000);
                                          };
                                          const fallback = () =>
                                            navigator.clipboard.writeText(plain).then(doSuccess).catch(() => {});
                                          /* Prefer ClipboardItem (rich text) so pasting into
                                             Google Docs / email / Notion preserves headings,
                                             bold, and bullet structure.  Falls back to plain
                                             text if the API is unavailable. */
                                          if (typeof ClipboardItem !== "undefined") {
                                            const html = markdownToHtml(msg.text);
                                            const item = new ClipboardItem({
                                              "text/html":  new Blob([html],  { type: "text/html" }),
                                              "text/plain": new Blob([plain], { type: "text/plain" }),
                                            });
                                            /* Guard: some environments expose ClipboardItem but
                                               not clipboard.write (mocked tests, older Safari).
                                               Sync throws must be caught separately from async
                                               Promise rejections. */
                                            try {
                                              navigator.clipboard.write([item]).then(doSuccess).catch(fallback);
                                            } catch {
                                              fallback();
                                            }
                                          } else {
                                            fallback();
                                          }
                                        }}
                                        title="Copy to clipboard"
                                        style={{
                                          display: "flex", alignItems: "center", justifyContent: "center",
                                          width: 26, height: 26, borderRadius: 6, border: "none",
                                          background: "transparent", cursor: "pointer", color: "#94a3b8",
                                          transition: "color 0.12s, background 0.12s",
                                        }}
                                        onMouseEnter={(e) => { e.currentTarget.style.color = NAVY; e.currentTarget.style.background = "#EEF2FF"; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.background = "transparent"; }}
                                        aria-label="Copy message"
                                      >
                                        <Copy size={13} />
                                      </button>
                                      {copiedMsgIdx === i && (
                                        <div style={{
                                          position: "absolute", top: "100%", right: 0, marginTop: 4,
                                          background: "#1e293b", color: "white", fontSize: 11,
                                          fontWeight: 600, padding: "3px 8px", borderRadius: 6,
                                          whiteSpace: "nowrap", pointerEvents: "none", zIndex: 50,
                                          fontFamily: "'Libre Franklin', sans-serif",
                                        }}>
                                          Copied!
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                                {msg.role === "ai"
                                  ? <AINarrativeRenderer text={msg.text} />
                                  : msg.text.split("**").map((part, pi) => {
                                      if (pi % 2 === 1) {
                                        if (/^\s*[\d,\.%]+\s*$/.test(part)) return part;
                                        return <strong key={pi} style={{ fontWeight: 600 }}>{part}</strong>;
                                      }
                                      return part;
                                    })
                                }
                              </div>
                              {msg.role === "ai" && msg.nextSteps && msg.nextSteps.length > 0 && (
                                <div className="px-1">
                                  <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 6, fontFamily: "'Libre Franklin', sans-serif" }}>Potential Next Steps:</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {msg.nextSteps.map((chip, ci) => (
                                      <button
                                        key={ci}
                                        onClick={() => handleSendChat(chip)}
                                        style={{ fontSize: 12, fontWeight: 500, color: NAVY, border: `1.5px solid ${NAVY}`, borderRadius: 20, padding: "4px 12px", background: "white", cursor: "pointer", transition: "background 0.12s", fontFamily: "'Libre Franklin', sans-serif" }}
                                        onMouseEnter={(e) => { e.currentTarget.style.background = "#EEF2FF"; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.background = "white"; }}
                                      >
                                        {chip}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {msg.role === "ai" && msg.matchedTeachers && msg.matchedTeachers.length > 0 && (
                                <div className="flex items-center gap-1.5 flex-wrap px-1">
                                  <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'Libre Franklin', sans-serif" }}>Looked at data for:</span>
                                  {msg.matchedTeachers.map((name, ni) => (
                                    <span key={ni} style={{ fontSize: 11, backgroundColor: "#EEF2FF", color: "#4338CA", borderRadius: 10, padding: "1px 8px", fontWeight: 500, fontFamily: "'Libre Franklin', sans-serif" }}>
                                      {name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      )}
                      {/* Loading spinner — shown while the first fetch for a
                          selected session is in flight and no messages have
                          arrived yet (no cache hit). */}
                      {activeChatId !== null && chatMsgs.length === 0 && messagesLoading && !chatTyping && !streamingText && (
                        <div className="flex justify-center py-10">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2" style={{ borderColor: NAVY }} />
                        </div>
                      )}
                      {/* Error state — shown when the messages fetch fails (e.g.
                          the session no longer exists or a network error). */}
                      {activeChatId !== null && chatMsgs.length === 0 && messagesError && !chatTyping && !streamingText && (
                        <p className="text-center py-10 text-xs" style={{ color: "#94a3b8", fontFamily: "'Libre Franklin', sans-serif" }}>
                          Couldn't load this conversation — click it again to retry.
                        </p>
                      )}
                      {activeChatId !== null && chatMsgs.length === 0 && !messagesLoading && !messagesError && !chatTyping && !streamingText && (
                        <div className="flex flex-col items-center py-12 gap-2 px-6">
                          <p className="text-center text-sm font-medium" style={{ color: "#64748b", fontFamily: "'Libre Franklin', sans-serif" }}>
                            No messages in this conversation.
                          </p>
                          <p className="text-center text-xs" style={{ color: "#94a3b8", fontFamily: "'Libre Franklin', sans-serif", maxWidth: 340 }}>
                            Run a new Instant Analysis to generate a fresh report for your school.
                          </p>
                        </div>
                      )}
                      {chatTyping && !streamingText && (
                        <div className="flex items-start gap-3">
                          <div className="px-4 py-3 bg-white border border-slate-200" style={{ borderRadius: "12px", boxShadow: "none" }}>
                            <div className="flex gap-1 items-center h-4">
                              {[0, 1, 2].map((d) => (
                                <div key={d} className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                      {streamingText && (
                        <div className="flex items-start gap-3">
                          <div
                            className="max-w-[80%] px-4 py-2.5 text-sm leading-relaxed"
                            style={{
                              backgroundColor: "white",
                              color:           "#1e293b",
                              border:          "1px solid #e2e8f0",
                              borderRadius:    "12px",
                              boxShadow:       "none",
                            }}
                          >
                            {(() => {
                              const display = stripNextStepsSentinel(streamingText);
                              return <><AINarrativeRenderer text={display} /><span className="inline-block w-0.5 h-3.5 bg-slate-400 ml-0.5 align-middle animate-pulse" /></>;
                            })()}
                          </div>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                  </ScrollArea>

                  {/* Input bar */}
                  <div className="shrink-0 mt-4 flex items-center gap-2">
                    {chatTyping || !!streamingText ? (
                      <button
                        onClick={handleStopGeneration}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                        style={{ backgroundColor: "#FEE2E2", color: "#b91c1c", border: "1.5px solid #fca5a5" }}
                      >
                        <Square size={14} fill="#b91c1c" /> Stop generating
                      </button>
                    ) : (
                      <>
                        <textarea
                          ref={chatTextareaRef}
                          value={chatInput}
                          rows={1}
                          onChange={(e) => {
                            setChatInput(e.target.value);
                            const el = e.target;
                            el.style.height = "auto";
                            el.style.height = Math.min(el.scrollHeight, 120) + "px";
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                          placeholder="Ask a follow-up question…"
                          className="flex-1 rounded-xl border border-slate-200 bg-white shadow-sm text-sm px-3 py-2.5 resize-none focus:outline-none focus:ring-1"
                          style={{
                            minHeight: 40,
                            maxHeight: 120,
                            overflowY: "auto",
                            lineHeight: "1.5",
                            fontFamily: "inherit",
                            '--tw-ring-color': NAVY,
                          } as React.CSSProperties}
                        />
                        <Button
                          onClick={() => handleSendChat()}
                          disabled={!chatInput.trim()}
                          className="rounded-xl w-10 h-10 p-0 shadow-sm flex items-center justify-center shrink-0 self-end"
                          style={{ backgroundColor: NAVY }}
                        >
                          <Send size={16} color="white" />
                        </Button>
                      </>
                    )}
                  </div>

                </div>
              )}

            </div>

          </TabsContent>

          {/* ════════════════════════════════════════════════════
              TAB 4 — WALKTHROUGH REPORT GENERATOR (DISTRICT_ADMIN only)
          ════════════════════════════════════════════════════ */}
          <TabsContent value="report-generator" className="flex-1 flex flex-col overflow-hidden mt-0">
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div
                  className="mx-auto mb-4 flex items-center justify-center rounded-full w-16 h-16"
                  style={{ backgroundColor: "#EEF2FF" }}
                >
                  <FileText size={28} style={{ color: NAVY }} />
                </div>
                <h2
                  className="text-xl font-bold mb-2"
                  style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em", fontSize: 22 }}
                >
                  Walkthrough Report Generator
                </h2>
                <p className="text-sm text-slate-500" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
                  This feature is coming soon. Generate school-wide walkthrough summary reports for sharing with principals and leadership teams.
                </p>
              </div>
            </div>
          </TabsContent>

        </Tabs>

      {/* New Observation Modal */}
      {allTeachers.length > 0 && (
        <NewObservationModal
          teachers={allTeachers}
          categories={categories}
          allDomains={allDomains}
          open={newObsOpen}
          onOpenChange={(o) => {
            setNewObsOpen(o);
            if (!o) setAddObsTeacherId(null);
          }}
          canMarkWalkthrough={currentUser?.role === "NETWORK_ADMIN" || currentUser?.role === "NETWORK_LEADER" || currentUser?.role === "SCHOOL_LEADER"}
          defaultTeacherId={addObsTeacherId ?? undefined}
          defaultIsWalkthrough={newObsIsWalkthrough}
          observerName={currentUser?.name}
          onSubmit={handleSubmitObs}
          saving={saving}
          rubricSetAudience={activeQuarterAudience}
          freshStart
        />
      )}

    </div>
  );
}
