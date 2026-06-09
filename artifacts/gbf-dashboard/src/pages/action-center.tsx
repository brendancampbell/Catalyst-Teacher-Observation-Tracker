import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Clock, Plus,
  TrendingUp, TrendingDown, BarChart2, Sparkles, Send,
  Bot, User2, Flame, ShieldAlert, Activity,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { safeReturnTo } from "@/lib/safeReturnTo";
import {
  fetchRescoreQueue,
  fetchDashboard,
  fetchQuarters,
  createObservation,
  fetchAIInsights,
  fetchAICalibrationFlags,
  fetchAIPlateauAlerts,
  fetchAIChat,
  type RescoreQueueItem,
  type RubricQuarterRow,
  type AICalibrationFlag,
  type AIPlateauAlert,
  type AIInsightsResponse,
  type AITrendingStep,
} from "@/lib/api";
import type { Teacher, Score } from "@/data/dummy";
import type { CategoryEntry, DomainEntry } from "@/lib/api";
import { NewObservationModal } from "@/components/NewObservationModal";
import { useUser } from "@/context/UserContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

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

type ChatMsg = { role: "user" | "ai"; text: string };

const WELCOME_MSG: ChatMsg = {
  role: "ai",
  text: "Hello! I'm your GBF Data Assistant. Ask me about your school's observation trends, domain scores, calibration flags, growth plateaus, or which teachers are closest to the 0.7 proficiency threshold.",
};

export default function ActionCenterPage() {
  const { currentUser } = useUser();
  const queryClient     = useQueryClient();
  const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const searchParams = new URLSearchParams(window.location.search);
  const rubricFromUrl = searchParams.get("rubric") ?? undefined;

  const returnTo = safeReturnTo(
    searchParams.get("returnTo"),
    baseUrl + "/",
  );

  /* ── Rescore queue ─────────────────────────────────── */
  const { data: queue = [], isLoading, isError } = useQuery<RescoreQueueItem[]>({
    queryKey: ["rescoreQueue"],
    queryFn:  fetchRescoreQueue,
    staleTime: 30_000,
  });

  /* ── Dashboard data ──────────────────────────────────── */
  const { data: quarters = [] } = useQuery<RubricQuarterRow[]>({
    queryKey: ["quarters"],
    queryFn:  () => fetchQuarters(),
    staleTime: 60_000,
  });

  const activeQuarter   = rubricFromUrl ?? quarters[0]?.slug ?? "Q1";
  const activeQuarterId = quarters.find((q) => q.slug === activeQuarter)?.id ?? quarters[0]?.id ?? 0;

  const { data: dashData } = useQuery({
    queryKey: ["dashboard", activeQuarter, null],
    queryFn:  () => fetchDashboard(activeQuarter, null),
    staleTime: 60_000,
    enabled:  !!activeQuarter,
  });

  const allTeachers: Teacher[]      = dashData?.teachers   ?? [];
  const categories:  CategoryEntry[] = dashData?.categories ?? [];
  const allDomains:  DomainEntry[]   = categories.flatMap((c) => c.domains);

  /* ── AI data ─────────────────────────────────────────── */
  const { data: insights } = useQuery<AIInsightsResponse>({
    queryKey: ["ai-insights", activeQuarter],
    queryFn:  () => fetchAIInsights(activeQuarter),
    staleTime: 60_000,
  });

  const { data: calibrationFlags = [] } = useQuery<AICalibrationFlag[]>({
    queryKey: ["ai-calibration-flags", activeQuarter],
    queryFn:  () => fetchAICalibrationFlags(activeQuarter),
    staleTime: 60_000,
  });

  const { data: plateauAlerts = [] } = useQuery<AIPlateauAlert[]>({
    queryKey: ["ai-plateau-alerts", activeQuarter],
    queryFn:  () => fetchAIPlateauAlerts(activeQuarter),
    staleTime: 60_000,
  });

  /* ── Compute real school avg ─────────────────────────── */
  const schoolAvg = (() => {
    if (!allTeachers.length || !allDomains.length) return null;
    const vals: number[] = [];
    for (const t of allTeachers) {
      for (const d of allDomains) {
        const obs = t.observations;
        if (!obs?.length) continue;
        const last = obs[obs.length - 1];
        const s = last?.scores?.[d.id];
        if (s !== undefined) vals.push(s as number);
      }
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();

  /* ── Add-Observation modal state ────────────────────── */
  const [addObsTeacherId,     setAddObsTeacherId]     = useState<string | null>(null);
  const [newObsOpen,          setNewObsOpen]           = useState(false);
  const [newObsIsWalkthrough, setNewObsIsWalkthrough]  = useState(false);
  const [saving, setSaving]                            = useState(false);

  function handleAddObsClick(teacherId: number, asWalkthrough = false) {
    setAddObsTeacherId(String(teacherId));
    setNewObsIsWalkthrough(asWalkthrough);
    setNewObsOpen(true);
  }

  async function handleSubmitObs(
    teacherId:    string,
    date:         string,
    scores:       Record<string, Score>,
    strengths:    string,
    growthAreas:  string,
    isWalkthrough: boolean,
    time:         string,
    course:       string,
  ): Promise<string> {
    setSaving(true);
    try {
      const obs = await createObservation({
        teacherId,
        rubricSetId: activeQuarterId,
        date,
        time:        time        || undefined,
        course:      course      || undefined,
        scores,
        strengths:   strengths   || undefined,
        growthAreas: growthAreas || undefined,
        observer:    currentUser?.name ?? "Unknown",
        observerId:  currentUser?.id,
        isWalkthrough,
      });
      queryClient.invalidateQueries({ queryKey: ["rescoreQueue"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["ai-plateau-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["ai-calibration-flags"] });
      queryClient.invalidateQueries({ queryKey: ["ai-insights"] });
      return obs.id;
    } catch (err) {
      console.error("Failed to save observation:", err);
      return "";
    } finally {
      setSaving(false);
    }
  }

  /* ── Chat state ──────────────────────────────────────── */
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([WELCOME_MSG]);
  const [chatInput, setChatInput] = useState("");
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

  /* ── Render ─────────────────────────────────────────── */
  return (
    <div className="h-full overflow-y-auto flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* Tabs wraps everything so TabsList can live inside the sticky bar */}
      <Tabs defaultValue="summary" className="flex-1 flex flex-col">

        {/* ── Frozen top bar (header + tab nav) ── */}
        <div className="sticky top-0 z-30 flex flex-col shadow-md">

          {currentUser && (
            <AppHeader
              subtitle="Action Center"
              backHref={returnTo}
              backLabel="Back to Dashboard"
              draftsHref={`${baseUrl}/drafts`}
              basePath={baseUrl}
              onAddObservation={() => setNewObsOpen(true)}
              actionCenterHref={`${baseUrl}/action-center`}
              userName={currentUser.name}
              userRole={currentUser.role}
              canAdmin={currentUser.role !== "COACH"}
              rubricSets={quarters.map((q) => ({ slug: q.slug, name: q.name }))}
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
                { value: "analysis",     label: "Analysis",      icon: <TrendingUp  size={15} /> },
                { value: "chat",         label: "Data Assistant", icon: <Sparkles   size={15} /> },
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
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <BarChart2 size={14} /> Current School Average
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  <div className="flex items-end gap-3">
                    <span
                      className="text-4xl font-bold tabular-nums"
                      style={{ color: schoolAvg !== null ? (schoolAvg >= 0.7 ? "#16a34a" : "#dc2626") : "#94a3b8",
                               fontFamily: "'Bebas Neue', sans-serif" }}
                    >
                      {schoolAvg !== null ? schoolAvg.toFixed(1) : "—"}
                    </span>
                    {schoolAvg !== null && (
                      <Badge
                        className="mb-1 text-xs font-bold px-2 py-0.5"
                        style={{
                          backgroundColor: schoolAvg >= 0.7 ? "#DCFCE7" : "#FEE2E2",
                          color: schoolAvg >= 0.7 ? "#15803D" : "#B91C1C",
                          border: "none",
                        }}
                      >
                        {schoolAvg >= 0.7 ? "Proficient" : "Not Yet"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Across all domains, most recent observations</p>
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <TrendingUp size={14} className="text-green-500" /> Top Domain Strength
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {insights?.topStrength ? (
                    <>
                      <p className="text-2xl font-bold leading-tight" style={{ color: "#15803D", fontFamily: "'Bebas Neue', sans-serif" }}>
                        {insights.topStrength.domain}
                      </p>
                      <p className="text-sm text-slate-500 mt-1">
                        Avg score <span className="font-bold text-green-600">{insights.topStrength.avg.toFixed(2)}</span> across {insights.topStrength.count} observation{insights.topStrength.count !== 1 ? "s" : ""}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5 italic flex items-center gap-1"><Sparkles size={10} /> AI-synthesized · live data</p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-slate-300" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>—</p>
                      <p className="text-sm text-slate-400 mt-1">No observation data yet</p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <TrendingDown size={14} className="text-red-500" /> Top Area for Growth
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {insights?.topGrowth ? (
                    <>
                      <p className="text-2xl font-bold leading-tight" style={{ color: "#B91C1C", fontFamily: "'Bebas Neue', sans-serif" }}>
                        {insights.topGrowth.domain}
                      </p>
                      <p className="text-sm text-slate-500 mt-1">
                        Avg score <span className="font-bold text-red-600">{insights.topGrowth.avg.toFixed(2)}</span> across {insights.topGrowth.count} observation{insights.topGrowth.count !== 1 ? "s" : ""}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5 italic flex items-center gap-1"><Sparkles size={10} /> AI-synthesized · live data</p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-slate-300" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>—</p>
                      <p className="text-sm text-slate-400 mt-1">No observation data yet</p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Calibration Flags */}
              <Card className="border-amber-200 shadow-sm" style={{ backgroundColor: "#FFFBEB" }}>
                <CardHeader className="px-5 pt-5 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-bold text-amber-800">
                    <ShieldAlert size={17} className="text-amber-500" />
                    Calibration Flags
                  </CardTitle>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Score discrepancies (≥ 0.5 pts) between School Coach and Network Walkthrough · live data
                  </p>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  {calibrationFlags.length === 0 ? (
                    <div className="flex items-center gap-2 py-2">
                      <CheckCircle2 size={16} className="text-green-500" />
                      <p className="text-sm text-slate-500">No calibration discrepancies detected.</p>
                    </div>
                  ) : (
                    calibrationFlags.map((flag, i) => (
                      <div key={i} className="bg-white rounded-lg px-4 py-3 border border-amber-100 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-700">{flag.teacher ?? flag.school ?? "—"}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{flag.domain}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-center">
                            <p className="text-xs text-slate-400">School</p>
                            <p className="text-sm font-bold" style={{ color: NAVY }}>{flag.schoolScore.toFixed(1)}</p>
                          </div>
                          <div className="text-slate-300 font-light">vs</div>
                          <div className="text-center">
                            <p className="text-xs text-slate-400">Network</p>
                            <p className="text-sm font-bold text-amber-700">{flag.networkScore.toFixed(1)}</p>
                          </div>
                          <Badge
                            className="text-xs font-bold ml-1"
                            style={{ backgroundColor: "#FEF3C7", color: "#92400E", border: "none" }}
                          >
                            Δ {flag.delta.toFixed(1)}
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Trending Action Steps — live from AI insights */}
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY }}>
                    <Flame size={17} style={{ color: YELLOW }} />
                    Trending Action Steps
                  </CardTitle>
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                    <Sparkles size={10} /> High-priority growth domains · live data
                  </p>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  {(insights?.trendingSteps ?? []).length > 0 ? (
                    (insights!.trendingSteps as AITrendingStep[]).map((step, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="shrink-0 w-11 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                          style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}>
                          {step.pct}%
                        </div>
                        <p className="text-sm text-slate-600 leading-snug">
                          <strong>{step.domain}</strong> — avg <strong style={{ color: "#B91C1C" }}>{step.avg.toFixed(2)}</strong>
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-400 italic">No high-priority growth domains identified yet.</p>
                  )}
                </CardContent>
              </Card>
            </div>

          </TabsContent>

          {/* ═══════════════════════════════════════════════════
              TAB 2 — INTERVENTION WORKFLOWS
          ════════════════════════════════════════════════════ */}
          <TabsContent value="intervention" className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-8 mt-0">

            {/* ── Rescore Queue ─────────────────────────────── */}
            <section>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                <div>
                  <h2
                    className="text-xl font-bold uppercase tracking-wider"
                    style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em" }}
                  >
                    Walkthrough Rescore Queue
                  </h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Teachers who received a walkthrough score below 0.7 and require a rescore within 14 days.
                  </p>
                </div>
                {!isLoading && (
                  <div
                    className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm"
                    style={{ backgroundColor: queue.length > 0 ? "#FEF3C7" : "#F0FDF4", color: queue.length > 0 ? "#92400E" : "#166534", border: `1.5px solid ${queue.length > 0 ? "#FCD34D" : "#86EFAC"}` }}
                  >
                    {queue.length > 0
                      ? <><AlertTriangle size={16} /> {queue.length} teacher{queue.length !== 1 ? "s" : ""} need rescoring</>
                      : <><CheckCircle2 size={16} /> Queue is clear</>
                    }
                  </div>
                )}
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
                            <th
                              key={i}
                              className="text-left px-4 py-3 text-white font-bold uppercase tracking-wider text-xs"
                              style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                        <tr style={{ height: 3, backgroundColor: YELLOW }}>
                          <td colSpan={6} style={{ padding: 0, height: 3 }} />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {queue.map((item) => {
                          const status = getDueStatus(item.rescoreDueDate);
                          return (
                            <tr key={item.teacherId} className="hover:bg-slate-50 transition-colors">
                              <td className="px-4 py-3 font-semibold">
                                <a
                                  href={`${baseUrl}/?teacher=${item.teacherId}`}
                                  className="hover:underline underline-offset-2"
                                  style={{ color: NAVY }}
                                >
                                  {item.teacherName}
                                </a>
                              </td>
                              <td className="px-4 py-3 text-slate-600">{item.schoolName ?? "—"}</td>
                              <td className="px-4 py-3 text-slate-600">
                                {item.subject}
                                <span className="text-slate-400 ml-1.5">
                                  {item.gradeLevel.length > 0 ? `· Gr. ${item.gradeLevel.join(", ")}` : ""}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-600">
                                {item.rescoreDueDate
                                  ? new Date(item.rescoreDueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                                  : "—"}
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className="inline-flex items-center gap-1.5 font-bold px-2.5 py-1 rounded-full text-xs"
                                  style={{ backgroundColor: status.urgent ? "#FEF2F2" : "#F0FDF4", color: status.color }}
                                >
                                  <Clock size={12} />
                                  {status.label}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => handleAddObsClick(item.teacherId, true)}
                                  className="inline-flex items-center gap-1.5 font-bold px-3 py-1.5 rounded-md text-xs transition-colors hover:opacity-90"
                                  style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.03em", fontSize: 13 }}
                                >
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

          </TabsContent>

          {/* ═══════════════════════════════════════════════════
              TAB 3 — ANALYSIS
          ════════════════════════════════════════════════════ */}
          <TabsContent value="analysis" className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 mt-0">
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
              <TrendingUp size={48} className="text-slate-300" />
              <p className="text-lg font-bold text-slate-400">Analysis coming soon</p>
              <p className="text-sm text-slate-400 max-w-sm">This tab will surface deep rubric analysis for your school.</p>
            </div>
          </TabsContent>

          {/* ═══════════════════════════════════════════════════
              TAB 4 — DATA ASSISTANT (CHAT)
          ════════════════════════════════════════════════════ */}
          <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-0 overflow-hidden">
            <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-4 sm:px-6 py-5 min-h-0">

              {/* Header */}
              <div className="flex items-center gap-3 mb-4 shrink-0">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                  style={{ backgroundColor: NAVY }}
                >
                  <Sparkles size={18} color={YELLOW} />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800 text-base">GBF Data Assistant</h2>
                  <p className="text-xs text-slate-400">Ask questions about your school's observation data</p>
                </div>
                <Badge
                  className="ml-auto text-xs font-bold px-2.5 py-1"
                  style={{ backgroundColor: "#DCFCE7", color: "#15803D", border: "none" }}
                >
                  Live Data
                </Badge>
              </div>

              {/* Message area */}
              <ScrollArea className="flex-1 min-h-0 pr-1">
                <div className="space-y-4 pb-2">
                  {chatMsgs.map((msg, i) => (
                    <div key={i} className={`flex items-start gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                      {/* Avatar */}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 shadow-sm"
                        style={{ backgroundColor: msg.role === "ai" ? NAVY : "#E2E8F0" }}
                      >
                        {msg.role === "ai"
                          ? <Bot size={15} color="white" />
                          : <User2 size={15} color="#64748B" />}
                      </div>
                      {/* Bubble */}
                      <div
                        className="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm"
                        style={{
                          backgroundColor: msg.role === "ai" ? "white" : NAVY,
                          color: msg.role === "ai" ? "#1e293b" : "white",
                          border: msg.role === "ai" ? "1px solid #e2e8f0" : "none",
                          borderRadius: msg.role === "ai" ? "4px 18px 18px 18px" : "18px 4px 18px 18px",
                        }}
                      >
                        {msg.text.split("**").map((part, pi) =>
                          pi % 2 === 1 ? <strong key={pi}>{part}</strong> : part
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {chatTyping && (
                    <div className="flex items-start gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: NAVY }}
                      >
                        <Bot size={15} color="white" />
                      </div>
                      <div
                        className="px-4 py-3 rounded-2xl bg-white shadow-sm border border-slate-200"
                        style={{ borderRadius: "4px 18px 18px 18px" }}
                      >
                        <div className="flex gap-1 items-center h-4">
                          {[0, 1, 2].map((d) => (
                            <div
                              key={d}
                              className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce"
                              style={{ animationDelay: `${d * 0.15}s` }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </ScrollArea>

              {/* Input bar */}
              <div className="shrink-0 mt-4 flex items-center gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                  placeholder="Ask about your school's observation data…"
                  className="flex-1 rounded-xl border-slate-200 bg-white shadow-sm text-sm focus-visible:ring-1"
                  style={{ '--tw-ring-color': NAVY } as React.CSSProperties}
                />
                <Button
                  onClick={handleSendChat}
                  disabled={!chatInput.trim() || chatTyping}
                  className="rounded-xl w-10 h-10 p-0 shadow-sm flex items-center justify-center shrink-0"
                  style={{ backgroundColor: NAVY }}
                >
                  <Send size={16} color="white" />
                </Button>
              </div>

            </div>
          </TabsContent>

        </Tabs>

      <footer className="text-center pt-1 pb-4 shrink-0" style={{ borderTop: "1px solid #dde3f0", color: "#94a3b8", fontSize: 12, fontFamily: "'Libre Franklin', sans-serif" }}>
        &copy; {new Date().getFullYear()} Uncommon Schools, Inc. All rights reserved. | This site is in beta and may have bugs. Share feedback and ideas by completing <a href="#" style={{ color: "#64748b", fontWeight: 600 }}>this form</a>.
      </footer>

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
          freshStart
        />
      )}

    </div>
  );
}
