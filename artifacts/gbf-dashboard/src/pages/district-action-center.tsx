import { useState, useRef, useEffect } from "react";
import {
  BarChart2, Sparkles, Activity, TrendingUp, TrendingDown,
  Flame, ShieldAlert, AlertTriangle, Building2, CheckCircle2, Send, Bot, User2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import AppHeader from "@/components/AppHeader";
import { safeReturnTo } from "@/lib/safeReturnTo";
import { useUser } from "@/context/UserContext";
import {
  fetchRescoreQueue,
  fetchAIInsights,
  fetchAICalibrationFlags,
  fetchAIPlateauAlerts,
  fetchAIChat,
  type RescoreQueueItem,
  type AICalibrationFlag,
  type AIPlateauAlert,
  type AIInsightsResponse,
  type AITrendingStep,
} from "@/lib/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

type ChatMsg = { role: "user" | "ai"; text: string };

const WELCOME_MSG: ChatMsg = {
  role: "ai",
  text: "Hello! I'm your GBF Network Data Assistant. Ask me about network-wide domain trends, school calibration flags, growth plateaus, or which schools need the most urgent support right now.",
};

export default function DistrictActionCenterPage() {
  const { currentUser } = useUser();
  const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const searchParams = new URLSearchParams(window.location.search);
  const rubricFromUrl = searchParams.get("rubric") ?? undefined;

  const returnTo = safeReturnTo(
    searchParams.get("returnTo"),
    baseUrl + "/",
  );

  /* ── AI data ─────────────────────────────────────────── */
  const { data: insights } = useQuery<AIInsightsResponse>({
    queryKey: ["ai-insights-network", rubricFromUrl],
    queryFn:  () => fetchAIInsights(rubricFromUrl),
    staleTime: 60_000,
  });

  const { data: calibrationFlags = [] } = useQuery<AICalibrationFlag[]>({
    queryKey: ["ai-calibration-flags-network", rubricFromUrl],
    queryFn:  () => fetchAICalibrationFlags(rubricFromUrl),
    staleTime: 60_000,
  });

  const { data: plateauAlerts = [] } = useQuery<AIPlateauAlert[]>({
    queryKey: ["ai-plateau-alerts-network", rubricFromUrl],
    queryFn:  () => fetchAIPlateauAlerts(rubricFromUrl),
    staleTime: 60_000,
  });

  const { data: rescoreQueue = [] } = useQuery<RescoreQueueItem[]>({
    queryKey: ["rescoreQueue-network"],
    queryFn:  fetchRescoreQueue,
    staleTime: 30_000,
  });

  /* ── School-level rescore summary ───────────────────── */
  const schoolRescoreSummary = (() => {
    const map = new Map<string, { total: number; overdue: number }>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const item of rescoreQueue) {
      const schoolName = item.schoolName ?? "Unknown";
      const entry = map.get(schoolName) ?? { total: 0, overdue: 0 };
      entry.total++;
      if (item.rescoreDueDate) {
        const due = new Date(item.rescoreDueDate + "T00:00:00");
        if (due < today) entry.overdue++;
      }
      map.set(schoolName, entry);
    }
    return Array.from(map.entries())
      .map(([school, data]) => ({ school, ...data }))
      .sort((a, b) => b.overdue - a.overdue || b.total - a.total);
  })();

  /* ── Network overall avg from insights ──────────────── */
  const networkAvg = (() => {
    if (!insights?.topStrength && !insights?.topGrowth) return null;
    const topAvg    = insights.topStrength?.avg ?? 0;
    const bottomAvg = insights.topGrowth?.avg   ?? 0;
    return (topAvg + bottomAvg) / 2;
  })();

  /* ── Chat state ──────────────────────────────────────── */
  const [chatMsgs,   setChatMsgs]   = useState<ChatMsg[]>([WELCOME_MSG]);
  const [chatInput,  setChatInput]  = useState("");
  const [chatTyping, setChatTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs, chatTyping]);

  async function handleSendChat() {
    const text = chatInput.trim();
    if (!text) return;
    setChatMsgs((prev) => [...prev, { role: "user", text }]);
    setChatInput("");
    setChatTyping(true);
    try {
      const { reply } = await fetchAIChat(text);
      setChatMsgs((prev) => [...prev, { role: "ai", text: reply }]);
    } catch {
      setChatMsgs((prev) => [
        ...prev,
        { role: "ai", text: "Sorry, I couldn't retrieve a response right now. Please try again." },
      ]);
    } finally {
      setChatTyping(false);
    }
  }

  /* ── Render ──────────────────────────────────────────── */
  return (
    <div className="h-full overflow-y-auto flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      <Tabs defaultValue="summary" className="flex-1 flex flex-col">

        {/* ── Frozen top bar ─────────────────────────────── */}
        <div className="sticky top-0 z-30 flex flex-col shadow-md">

          {currentUser && (
            <AppHeader
              subtitle="Network Action Center"
              backHref={returnTo}
              backLabel="Back to Network Overview"
              basePath={baseUrl}
              draftsHref={`${baseUrl}/drafts`}
              actionCenterHref={`${baseUrl}/district-action-center`}
              userName={currentUser.name}
              userRole={currentUser.role}
              canAdmin={currentUser.role !== "COACH"}
            />
          )}

          {/* Tab bar */}
          <div className="bg-white border-b border-slate-200 px-4 sm:px-6">
            <TabsList className="h-auto bg-transparent gap-0 p-0 rounded-none">
              {[
                { value: "summary",       label: "Network-Wide Summary", icon: <BarChart2 size={15} /> },
                { value: "intervention",  label: "Network Interventions", icon: <Activity  size={15} /> },
                { value: "chat",          label: "Network Data Assistant", icon: <Sparkles  size={15} /> },
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

        {/* ═══════════════════════════════════════════════════════
            TAB 1 — NETWORK-WIDE SUMMARY
        ════════════════════════════════════════════════════════ */}
        <TabsContent value="summary" className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6 mt-0">

          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* Current Network Average */}
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <BarChart2 size={14} /> Current Network Average
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {networkAvg !== null ? (
                  <>
                    <div className="flex items-end gap-3">
                      <span
                        className="text-4xl font-bold tabular-nums"
                        style={{ color: networkAvg >= 0.7 ? "#16a34a" : "#dc2626", fontFamily: "'Bebas Neue', sans-serif" }}
                      >
                        {networkAvg.toFixed(2)}
                      </span>
                      <Badge className="mb-1 text-xs font-bold px-2 py-0.5"
                        style={{
                          backgroundColor: networkAvg >= 0.7 ? "#dcfce7" : "#fee2e2",
                          color: networkAvg >= 0.7 ? "#15803d" : "#b91c1c",
                          border: "none",
                        }}>
                        {networkAvg >= 0.7 ? "Proficient" : "Not Yet"}
                      </Badge>
                    </div>
                    <p className="text-slate-400 text-xs mt-1">Across all schools, most recent observations</p>
                    <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "#94a3b8", fontStyle: "italic" }}><Sparkles size={10} /> AI-synthesized · live data</p>
                  </>
                ) : (
                  <>
                    <span className="text-4xl font-bold tabular-nums text-slate-300" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>—</span>
                    <p className="text-slate-400 text-xs mt-1">No observation data yet</p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Top Network Strength */}
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <TrendingUp size={14} className="text-green-500" /> Top Network Strength
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {insights?.topStrength ? (
                  <>
                    <p className="text-2xl font-bold leading-tight" style={{ color: "#16a34a", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}>
                      {insights.topStrength.domain}
                    </p>
                    <p className="text-slate-500 text-sm mt-1">
                      Avg score <span className="font-bold text-green-600">{insights.topStrength.avg.toFixed(2)}</span> across all schools
                    </p>
                    <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "#94a3b8", fontStyle: "italic" }}><Sparkles size={10} /> AI-synthesized · live data</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-slate-300" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>—</p>
                    <p className="text-slate-400 text-sm mt-1">No observation data yet</p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Highest Priority Growth Area */}
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <TrendingDown size={14} className="text-red-500" /> Highest Priority Growth Area
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {insights?.topGrowth ? (
                  <>
                    <p className="text-2xl font-bold leading-tight" style={{ color: "#dc2626", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}>
                      {insights.topGrowth.domain}
                    </p>
                    <p className="text-slate-500 text-sm mt-1">
                      Avg score <span className="font-bold text-red-600">{insights.topGrowth.avg.toFixed(2)}</span> across all schools
                    </p>
                    <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "#94a3b8", fontStyle: "italic" }}><Sparkles size={10} /> AI-synthesized · live data</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-slate-300" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>—</p>
                    <p className="text-slate-400 text-sm mt-1">No observation data yet</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Trending Action Steps */}
          {(insights?.trendingSteps ?? []).length > 0 && (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="px-5 pt-5 pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em", fontSize: 18 }}>
                  <Flame size={17} style={{ color: YELLOW }} />
                  Trending Action Steps
                </CardTitle>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                  <Sparkles size={10} /> High-priority growth domains across the network · live data
                </p>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(insights!.trendingSteps as AITrendingStep[]).map((step, i) => (
                    <div key={i} className="flex items-start gap-3 bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
                      <div className="shrink-0 w-11 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                        style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}>
                        {step.pct}%
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-700">{step.domain}</p>
                        <p className="text-xs text-slate-500 mt-0.5">avg <strong style={{ color: "#B91C1C" }}>{step.avg.toFixed(2)}</strong></p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Network-Wide Flags */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* School Calibration Flags */}
            <Card className="border-slate-200 shadow-sm" style={{ borderTop: `3px solid ${YELLOW}` }}>
              <CardHeader className="px-5 pt-5 pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: "#92400e", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em", fontSize: 18 }}>
                  <AlertTriangle size={16} style={{ color: YELLOW }} />
                  School Calibration Flags
                </CardTitle>
                <p className="text-xs text-amber-600 mt-0.5">
                  Score discrepancies (≥ 0.5 pts) between School Coach and Network Walkthrough · live data
                </p>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-3">
                {calibrationFlags.length === 0 ? (
                  <div className="flex items-center gap-2 py-2">
                    <CheckCircle2 size={16} className="text-green-500" />
                    <p className="text-sm text-slate-500">No calibration discrepancies detected across the network.</p>
                  </div>
                ) : (
                  calibrationFlags.map((flag, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5"
                      style={{ backgroundColor: "#FFFBEB", border: "1px solid #FDE68A" }}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate" style={{ color: NAVY }}>{flag.teacher ?? flag.school ?? "—"}</p>
                        <p className="text-xs text-slate-500 truncate">{flag.domain}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-xs">
                        <span className="text-slate-500">
                          School <span className="font-bold text-slate-700">{flag.schoolScore.toFixed(1)}</span>
                        </span>
                        <span className="text-slate-300">vs</span>
                        <span className="text-slate-500">
                          Network <span className="font-bold text-slate-700">{flag.networkScore.toFixed(1)}</span>
                        </span>
                        <Badge
                          className="font-bold text-xs px-2 py-0.5"
                          style={{
                            backgroundColor: flag.delta >= 0.7 ? "#fee2e2" : "#fef3c7",
                            color: flag.delta >= 0.7 ? "#b91c1c" : "#92400e",
                            border: "none",
                          }}
                        >
                          Δ {flag.delta.toFixed(1)}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Growth Plateau Summary */}
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="px-5 pt-5 pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em", fontSize: 18 }}>
                  <Flame size={16} style={{ color: YELLOW }} />
                  Network Growth Plateau Summary
                </CardTitle>
                <p className="text-xs text-slate-400 mt-0.5">Teachers with no score improvement across 3+ consecutive observations · live data</p>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-3">
                {plateauAlerts.length === 0 ? (
                  <div className="flex items-center gap-2 py-2">
                    <CheckCircle2 size={16} className="text-green-500" />
                    <p className="text-sm text-slate-500">No growth plateaus detected network-wide.</p>
                  </div>
                ) : (
                  plateauAlerts.slice(0, 5).map((alert, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span
                        className="shrink-0 font-bold text-xs px-2 py-1 rounded-md mt-0.5"
                        style={{ backgroundColor: "#FEE2E2", color: "#B91C1C", minWidth: 40, textAlign: "center" }}
                      >
                        {alert.obsCount}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-slate-700">{alert.teacherName}</p>
                        <p className="text-xs text-slate-500">
                          Stuck on <strong>{alert.domain}</strong> at {alert.score.toFixed(1)} for {alert.weekRange}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                {plateauAlerts.length > 5 && (
                  <p className="text-xs text-slate-400 text-right">+{plateauAlerts.length - 5} more in Interventions tab</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 2 — NETWORK INTERVENTIONS
        ════════════════════════════════════════════════════════ */}
        <TabsContent value="intervention" className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6 mt-0">

          {/* Rescore Queue */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="px-5 pt-5 pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em", fontSize: 20 }}>
                  <ShieldAlert size={18} style={{ color: NAVY }} />
                  Network Walkthrough Rescore Queue
                </CardTitle>
                <Badge className="text-xs font-bold px-3 py-1" style={{ backgroundColor: "#EEF2FF", color: NAVY, border: "none" }}>
                  {rescoreQueue.length} total pending
                </Badge>
              </div>
              <p className="text-xs text-slate-400 mt-1">Teachers across all schools awaiting walkthrough rescore review · live data</p>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {schoolRescoreSummary.length === 0 ? (
                <div className="flex items-center gap-2 py-4">
                  <CheckCircle2 size={20} className="text-green-500" />
                  <p className="text-slate-500 font-semibold">All clear — no pending rescores across the network.</p>
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr style={{ backgroundColor: NAVY }}>
                        {["School", "Pending Rescores", "Overdue", "Status"].map((h) => (
                          <th
                            key={h}
                            className="text-left px-4 py-2.5 text-white font-bold uppercase tracking-wider"
                            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.04em" }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                      <tr style={{ height: 3, backgroundColor: YELLOW }}>
                        <td colSpan={4} style={{ padding: 0, height: 3 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {schoolRescoreSummary.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b transition-colors"
                          style={{ borderColor: "#e8edf8", backgroundColor: i % 2 === 0 ? "#ffffff" : "#f7f9fd" }}
                        >
                          <td className="px-4 py-3 font-semibold" style={{ color: NAVY }}>{row.school}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-base" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY }}>{row.total}</span>
                              <span className="text-slate-400 text-xs">teachers</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {row.overdue > 0 ? (
                              <Badge className="font-bold text-xs px-2 py-0.5" style={{ backgroundColor: "#fee2e2", color: "#b91c1c", border: "none" }}>
                                {row.overdue} overdue
                              </Badge>
                            ) : (
                              <Badge className="font-bold text-xs px-2 py-0.5" style={{ backgroundColor: "#dcfce7", color: "#15803d", border: "none" }}>
                                None overdue
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              className="text-xs font-semibold px-2 py-0.5"
                              style={{
                                backgroundColor: row.overdue >= 3 ? "#fee2e2" : row.overdue > 0 ? "#fef3c7" : "#f1f5f9",
                                color: row.overdue >= 3 ? "#b91c1c" : row.overdue > 0 ? "#92400e" : "#64748b",
                                border: "none",
                              }}
                            >
                              {row.overdue >= 3 ? "Urgent" : row.overdue > 0 ? "Needs Attention" : "On Track"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* School Support Alerts (plateau-based) */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Flame size={18} style={{ color: "#ea580c" }} />
              <h2 className="font-bold text-lg" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em", fontSize: 20 }}>
                Growth Plateau Alerts
              </h2>
              <span className="text-slate-400 text-sm font-normal ml-1">Teachers stuck on a domain network-wide · live data</span>
            </div>

            {plateauAlerts.length === 0 ? (
              <Card className="border-slate-200 shadow-sm flex flex-col items-center justify-center py-10 gap-3">
                <CheckCircle2 size={40} className="text-green-400" />
                <div className="text-center">
                  <p className="font-bold text-base" style={{ color: NAVY }}>No growth plateaus detected network-wide</p>
                  <p className="text-slate-500 text-sm mt-1">All teachers have shown score movement across recent observations.</p>
                </div>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {plateauAlerts.map((alert, i) => (
                  <Card
                    key={i}
                    className="border shadow-sm"
                    style={{
                      borderColor: alert.score < 0.3 ? "#fca5a5" : "#fde68a",
                      borderLeft: `4px solid ${alert.score < 0.3 ? "#dc2626" : "#f59e0b"}`,
                    }}
                  >
                    <CardContent className="px-4 py-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Building2 size={14} style={{ color: NAVY, flexShrink: 0 }} />
                          <span className="font-bold text-sm truncate" style={{ color: NAVY }}>{alert.teacherName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge
                            className="text-xs font-bold px-2 py-0.5"
                            style={{
                              backgroundColor: alert.score < 0.3 ? "#fee2e2" : "#fef3c7",
                              color: alert.score < 0.3 ? "#b91c1c" : "#92400e",
                              border: "none",
                            }}
                          >
                            {alert.score < 0.3 ? "High Priority" : "Monitor"}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Stuck on <strong>{alert.domain}</strong> at score <strong>{alert.score.toFixed(1)}</strong> for {alert.obsCount} consecutive observations over {alert.weekRange}.
                        {alert.subject ? ` (${alert.subject}${alert.gradeLevel?.length ? ` · Gr. ${alert.gradeLevel.join(", ")}` : ""})` : ""}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 3 — NETWORK DATA ASSISTANT
        ════════════════════════════════════════════════════════ */}
        <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-0 overflow-hidden">
          <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-4 sm:px-6 py-5 min-h-0 gap-4">

            {/* Header */}
            <div className="flex items-center gap-3 shrink-0">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                style={{ backgroundColor: NAVY }}
              >
                <Sparkles size={18} color={YELLOW} />
              </div>
              <div>
                <h2 className="font-bold text-slate-800 text-base">GBF Network Data Assistant</h2>
                <p className="text-xs text-slate-400">Ask questions about cross-school observation data</p>
              </div>
              <Badge
                className="ml-auto text-xs font-bold px-2.5 py-1 shrink-0"
                style={{ backgroundColor: "#DCFCE7", color: "#15803D", border: "none" }}
              >
                Live Data
              </Badge>
            </div>

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-2 pr-1">
              {chatMsgs.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "ai" && (
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 shadow-sm" style={{ backgroundColor: NAVY }}>
                      <Bot size={15} className="text-white" />
                    </div>
                  )}
                  <div
                    className="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm"
                    style={
                      msg.role === "user"
                        ? { backgroundColor: NAVY, color: "white", borderRadius: "18px 4px 18px 18px" }
                        : { backgroundColor: "white", color: "#1e293b", border: "1px solid #e2e8f0", borderRadius: "4px 18px 18px 18px" }
                    }
                  >
                    {msg.text.split("**").map((part, pi) =>
                      pi % 2 === 1 ? <strong key={pi}>{part}</strong> : part
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                      style={{ backgroundColor: YELLOW }}
                    >
                      <User2 size={15} style={{ color: NAVY }} />
                    </div>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {chatTyping && (
                <div className="flex gap-3 justify-start">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: NAVY }}>
                    <Bot size={15} className="text-white" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl bg-white border border-slate-200 shadow-sm" style={{ borderRadius: "4px 18px 18px 18px" }}>
                    <div className="flex gap-1 items-center h-4">
                      {[0, 1, 2].map((j) => (
                        <span
                          key={j}
                          className="w-1.5 h-1.5 rounded-full animate-bounce"
                          style={{ backgroundColor: "#94a3b8", animationDelay: `${j * 0.18}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-slate-200 pt-4">
              <form
                onSubmit={(e) => { e.preventDefault(); handleSendChat(); }}
                className="flex gap-2"
              >
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask about network trends, school comparisons, growth areas…"
                  className="flex-1 rounded-xl border-slate-300 text-sm focus-visible:ring-2"
                  style={{ "--tw-ring-color": NAVY } as React.CSSProperties}
                  disabled={chatTyping}
                />
                <Button
                  type="submit"
                  disabled={!chatInput.trim() || chatTyping}
                  className="rounded-xl px-4 shrink-0"
                  style={{ backgroundColor: NAVY, color: "white" }}
                >
                  <Send size={16} />
                </Button>
              </form>
            </div>
          </div>
        </TabsContent>

      </Tabs>

      {/* Footer */}
      <footer className="text-center pt-1 pb-4 shrink-0" style={{ borderTop: "1px solid #dde3f0", color: "#94a3b8", fontSize: 12, fontFamily: "'Libre Franklin', sans-serif" }}>
        &copy; {new Date().getFullYear()} Uncommon Schools, Inc. All rights reserved. | This site is in beta and may have bugs. Share feedback and ideas by completing <a href="#" style={{ color: "#64748b", fontWeight: 600 }}>this form</a>.
      </footer>
    </div>
  );
}
