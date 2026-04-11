import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Clock, Plus,
  TrendingUp, TrendingDown, BarChart2, Sparkles, Send,
  Bot, User2, Flame, ShieldAlert, Activity,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import {
  fetchRescoreQueue,
  fetchDashboard,
  fetchQuarters,
  createObservation,
  type RescoreQueueItem,
  type RubricQuarterRow,
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

/* ── Fake data ─────────────────────────────────────── */
const TRENDING_STEPS = [
  { pct: 38, insight: "Observations linked action steps to \"Sequential Directions\" in Classroom Culture." },
  { pct: 29, insight: "Teachers flagged for growth in \"Academic Monitoring 101\" this quarter." },
  { pct: 21, insight: "Recurring coaching around \"WTD Cycle\" pacing for ELA classrooms." },
  { pct: 17, insight: "\"Joy\" noted as a consistent strength across the Math department." },
];

const CALIBRATION_FLAGS = [
  {
    teacher: "Rachel Kim",
    domain: "Ratio & Engagement",
    schoolScore: 0.5,
    districtScore: 1.0,
    delta: 0.5,
  },
  {
    teacher: "Derek Thompson",
    domain: "F15: Entry / DN / DNR",
    schoolScore: 1.0,
    districtScore: 0.5,
    delta: 0.5,
  },
  {
    teacher: "James Mitchell",
    domain: "Confident Presence",
    schoolScore: 0.5,
    districtScore: 0.0,
    delta: 0.5,
  },
];

const PLATEAU_ALERTS = [
  {
    teacher: "Sarah Johnson",
    domain: "WTD Cycle",
    score: 0.0,
    obsCount: 3,
    weekRange: "4 weeks",
    subject: "English · Grade 6",
  },
  {
    teacher: "Derek Thompson",
    domain: "Annotations & Notebook Habits",
    score: 0.5,
    obsCount: 3,
    weekRange: "5 weeks",
    subject: "History · Grade 8",
  },
  {
    teacher: "Lisa Hernandez",
    domain: "Academic Monitoring 101",
    score: 0.0,
    obsCount: 4,
    weekRange: "6 weeks",
    subject: "Science · Grade 7",
  },
];

type ChatMsg = { role: "user" | "ai"; text: string };

const SEED_CHAT: ChatMsg[] = [
  { role: "user", text: "What are the biggest trends in the Math department this month?" },
  {
    role: "ai",
    text: "Based on the last 15 observations, the Math department is excelling in **Ratio & Engagement** (avg 0.9) but consistently underperforming in **Annotations & Notebook Habits** (avg 0.4). I'd recommend a targeted coaching cycle on note-taking routines.",
  },
  { role: "user", text: "Which teachers are closest to crossing the 0.7 proficiency threshold?" },
  {
    role: "ai",
    text: "Derek Thompson (avg 0.6) and Sarah Johnson (avg 0.5) are within striking distance. Derek's strongest domain is Joy (1.0); focusing his next cycle on WTD Cycle could push him over threshold within 2–3 observations.",
  },
  { role: "user", text: "Are there any calibration concerns I should know about?" },
  {
    role: "ai",
    text: "Yes — I've flagged 3 potential calibration discrepancies where School Coach scores differ from Network Walkthrough scores by ≥ 0.5 points. The largest gap is in Rachel Kim's Ratio & Engagement scores. I'd recommend a calibration session before the next round of walkthroughs.",
  },
];

/* ─────────────────────────────────────────────────── */

export default function ActionCenterPage() {
  const { currentUser } = useUser();
  const queryClient     = useQueryClient();
  const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  /* ── Rescore queue ─────────────────────────────────── */
  const { data: queue = [], isLoading, isError } = useQuery<RescoreQueueItem[]>({
    queryKey: ["rescoreQueue"],
    queryFn:  fetchRescoreQueue,
    staleTime: 30_000,
  });

  /* ── Dashboard data ──────────────────────────────────── */
  const { data: quarters = [] } = useQuery<RubricQuarterRow[]>({
    queryKey: ["quarters"],
    queryFn:  fetchQuarters,
    staleTime: 60_000,
  });

  const activeQuarter   = quarters[0]?.slug ?? "Q1";
  const activeQuarterId = quarters[0]?.id   ?? 0;

  const { data: dashData } = useQuery({
    queryKey: ["dashboard", activeQuarter, null],
    queryFn:  () => fetchDashboard(activeQuarter, null),
    staleTime: 60_000,
    enabled:  !!activeQuarter,
  });

  const allTeachers: Teacher[]      = dashData?.teachers   ?? [];
  const categories:  CategoryEntry[] = dashData?.categories ?? [];
  const allDomains:  DomainEntry[]   = categories.flatMap((c) => c.domains);

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
  ) {
    setSaving(true);
    try {
      await createObservation({
        teacherId,
        rubricSetId: activeQuarterId,
        date,
        scores,
        strengths:   strengths   || undefined,
        growthAreas: growthAreas || undefined,
        observer:    currentUser?.name ?? "Unknown",
        observerId:  currentUser?.id,
        isWalkthrough,
      });
      queryClient.invalidateQueries({ queryKey: ["rescoreQueue"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } finally {
      setSaving(false);
      setNewObsOpen(false);
      setAddObsTeacherId(null);
    }
  }

  /* ── Chat state ──────────────────────────────────────── */
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>(SEED_CHAT);
  const [chatInput, setChatInput] = useState("");
  const [chatTyping, setChatTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs, chatTyping]);

  function handleSendChat() {
    const text = chatInput.trim();
    if (!text) return;
    setChatMsgs((prev) => [...prev, { role: "user", text }]);
    setChatInput("");
    setChatTyping(true);
    setTimeout(() => {
      setChatTyping(false);
      setChatMsgs((prev) => [
        ...prev,
        {
          role: "ai",
          text: "This is a placeholder response. In the live version, I'll analyze your school's observation data and surface real insights here.",
        },
      ]);
    }, 1400);
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
              backHref={`${baseUrl}/`}
              backLabel="Back to Dashboard"
              basePath={baseUrl}
              onAddObservation={() => setNewObsOpen(true)}
              actionCenterHref={`${baseUrl}/action-center`}
              userName={currentUser.name}
              userRole={currentUser.role}
              canAdmin={currentUser.role !== "COACH"}
            />
          )}

          {/* Tab bar */}
          <div className="bg-white border-b border-slate-200 px-4 sm:px-6">
            <TabsList className="h-auto bg-transparent gap-0 p-0 rounded-none">
              {[
                { value: "summary",      label: "School-Wide Summary", icon: <BarChart2 size={15} /> },
                { value: "intervention", label: "Intervention",         icon: <Activity   size={15} /> },
                { value: "chat",         label: "Data Assistant",       icon: <Sparkles   size={15} /> },
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

            {/* AI Disclaimer */}
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl border"
              style={{ backgroundColor: "#FFFBEB", borderColor: "#FCD34D" }}>
              <Sparkles size={18} className="mt-0.5 shrink-0" style={{ color: "#D97706" }} />
              <p className="text-sm text-amber-800">
                <span className="font-bold">AI Features Coming Soon —</span> The cards below show placeholder data.
                Once connected to an AI model, this page will automatically synthesize your school's observation data into real-time insights.
              </p>
            </div>

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
                  <p className="text-2xl font-bold" style={{ color: "#15803D", fontFamily: "'Bebas Neue', sans-serif" }}>Joy</p>
                  <p className="text-sm text-slate-500 mt-1">Avg score <span className="font-bold text-green-600">0.9</span> across 6 teachers</p>
                  <p className="text-xs text-slate-400 mt-0.5 italic">AI-synthesized · placeholder</p>
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <TrendingDown size={14} className="text-red-500" /> Top Area for Growth
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  <p className="text-2xl font-bold" style={{ color: "#B91C1C", fontFamily: "'Bebas Neue', sans-serif" }}>Academic Mon. 101</p>
                  <p className="text-sm text-slate-500 mt-1">Avg score <span className="font-bold text-red-600">0.3</span> across 6 teachers</p>
                  <p className="text-xs text-slate-400 mt-0.5 italic">AI-synthesized · placeholder</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Trending Action Steps */}
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY }}>
                    <Flame size={17} style={{ color: YELLOW }} />
                    Trending Action Steps
                  </CardTitle>
                  <p className="text-xs text-slate-400 mt-0.5">Aggregated themes from recent observations · placeholder data</p>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  {TRENDING_STEPS.map((step, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div
                        className="shrink-0 w-11 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                        style={{ backgroundColor: "#EEF1FB", color: NAVY }}
                      >
                        {step.pct}%
                      </div>
                      <p className="text-sm text-slate-600 leading-snug">{step.insight}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Calibration Flags */}
              <Card className="border-amber-200 shadow-sm" style={{ backgroundColor: "#FFFBEB" }}>
                <CardHeader className="px-5 pt-5 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-bold text-amber-800">
                    <ShieldAlert size={17} className="text-amber-500" />
                    Calibration Flags
                  </CardTitle>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Score discrepancies (≥ 0.5 pts) between School Coach and Network Walkthrough · placeholder data
                  </p>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  {CALIBRATION_FLAGS.map((flag, i) => (
                    <div key={i} className="bg-white rounded-lg px-4 py-3 border border-amber-100 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-700">{flag.teacher}</p>
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
                          <p className="text-sm font-bold text-amber-700">{flag.districtScore.toFixed(1)}</p>
                        </div>
                        <Badge
                          className="text-xs font-bold ml-1"
                          style={{ backgroundColor: "#FEF3C7", color: "#92400E", border: "none" }}
                        >
                          Δ {flag.delta.toFixed(1)}
                        </Badge>
                      </div>
                    </div>
                  ))}
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
                              className="px-4 py-3 text-left font-bold uppercase tracking-wider text-white"
                              style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.04em" }}
                            >
                              {h}
                            </th>
                          ))}
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

            <Separator />

            {/* ── Growth Plateau Alerts ───────────────────────── */}
            <section>
              <div className="mb-4">
                <h2
                  className="text-xl font-bold uppercase tracking-wider"
                  style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em" }}
                >
                  Growth Plateau Alerts
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Teachers showing no score improvement in a specific domain over their last 3+ observations.
                  <span className="italic text-slate-400 ml-1">· Placeholder data</span>
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {PLATEAU_ALERTS.map((alert, i) => (
                  <Card key={i} className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="px-5 py-4">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <p className="font-bold text-slate-800">{alert.teacher}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{alert.subject}</p>
                        </div>
                        <Badge
                          className="shrink-0 text-xs font-bold px-2 py-0.5"
                          style={{ backgroundColor: "#FEE2E2", color: "#B91C1C", border: "none" }}
                        >
                          Stuck
                        </Badge>
                      </div>
                      <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Domain</p>
                        <p className="text-sm font-bold" style={{ color: NAVY }}>{alert.domain}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span
                            className="text-xl font-bold"
                            style={{ fontFamily: "'Bebas Neue', sans-serif", color: alert.score >= 0.7 ? "#16a34a" : "#dc2626" }}
                          >
                            {alert.score.toFixed(1)}
                          </span>
                          <span className="text-xs text-slate-400">
                            for {alert.obsCount} consecutive observations · {alert.weekRange}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const t = allTeachers.find((x) => x.name === alert.teacher);
                          if (t) handleAddObsClick(Number(t.id));
                        }}
                        className="mt-3 w-full text-xs font-bold py-2 rounded-md border transition-colors hover:opacity-80"
                        style={{ color: NAVY, borderColor: "#c7d0f0", backgroundColor: "#EEF1FB" }}
                      >
                        + Add Observation
                      </button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

          </TabsContent>

          {/* ═══════════════════════════════════════════════════
              TAB 3 — DATA ASSISTANT (CHAT)
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
                  style={{ backgroundColor: "#FEF3C7", color: "#92400E", border: "none" }}
                >
                  Preview · Placeholder
                </Badge>
              </div>

              {/* AI disclaimer */}
              <div className="shrink-0 mb-4 flex items-start gap-2 px-4 py-3 rounded-xl border"
                style={{ backgroundColor: "#EEF1FB", borderColor: "#c7d0f0" }}>
                <Sparkles size={15} className="mt-0.5 shrink-0" style={{ color: NAVY }} />
                <p className="text-xs" style={{ color: NAVY }}>
                  <span className="font-bold">Mockup only.</span> Responses below are pre-written examples.
                  The live version will connect to an AI model with access to your real observation data.
                </p>
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

      <footer className="text-center py-4 shrink-0" style={{ borderTop: "1px solid #dde3f0", color: "#94a3b8", fontSize: 12, fontFamily: "'Libre Franklin', sans-serif" }}>
        &copy; 2026 Uncommon Schools, Inc. All rights reserved.
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
        />
      )}

    </div>
  );
}
