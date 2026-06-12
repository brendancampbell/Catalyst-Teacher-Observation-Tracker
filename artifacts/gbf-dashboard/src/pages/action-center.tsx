import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Clock, Plus,
  TrendingUp, TrendingDown, BarChart2, Sparkles, Send,
  Bot, User2, ShieldAlert, Activity, Globe2, FileText,
  Download, ChevronRight, RefreshCw, X,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { safeReturnTo } from "@/lib/safeReturnTo";
import {
  fetchRescoreQueue,
  fetchOverdueObservations,
  fetchDashboard,
  fetchDistrictSummary,
  fetchNetworkAverages,
  fetchQuarters,
  createObservation,
  fetchAIInsights,
  fetchAICalibrationFlags,
  fetchAIPlateauAlerts,
  fetchAIChat,
  type RescoreQueueItem,
  type OverdueTeacher,
  type RubricQuarterRow,
  type AICalibrationFlag,
  type AIPlateauAlert,
  type AIInsightsResponse,
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
  const rubricFromUrl    = searchParams.get("rubric") ?? undefined;
  const schoolIdFromUrl  = searchParams.get("schoolId");
  const _parsedSchoolId  = schoolIdFromUrl ? parseInt(schoolIdFromUrl, 10) : null;
  const schoolId         = _parsedSchoolId !== null && isNaN(_parsedSchoolId) ? null : _parsedSchoolId;
  const schoolNameFromUrl = searchParams.get("schoolName") ?? "This School";

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
  const { data: quarters = [] } = useQuery<RubricQuarterRow[]>({
    queryKey: ["quarters"],
    queryFn:  () => fetchQuarters(),
    staleTime: 60_000,
  });

  const activeQuarter        = rubricFromUrl ?? quarters[0]?.slug ?? "Q1";
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

  const { data: plateauAlerts = [] } = useQuery<AIPlateauAlert[]>({
    queryKey: ["ai-plateau-alerts", activeQuarter, schoolId],
    queryFn:  () => fetchAIPlateauAlerts(activeQuarter, schoolId),
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
        const last = obs[obs.length - 1];
        const s = last?.scores?.[d.id];
        if (s !== undefined) vals.push(s as number);
      }
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();

  /* ── Intervention sub-tab ───────────────────────────── */
  const [interventionTab, setInterventionTab] = useState<"rescore" | "overdue" | "calibration">("rescore");
  const [analysisTab, setAnalysisTab] = useState<"analysis-summary" | "data-assistant">("analysis-summary");

  /* ── Analysis Summary docs ───────────────────────────── */
  type AnalysisDoc = {
    id: string;
    title: string;
    generatedAt: string;
    rubricSet: string;
    status: "complete" | "generating";
  };

  const [analysisDocs, setAnalysisDocs] = useState<AnalysisDoc[]>([
    { id: "mock-1", title: "Q2 Analysis",      generatedAt: "2026-05-28T09:15:00Z", rubricSet: "Q2", status: "complete" },
    { id: "mock-2", title: "Q1 Mid-Year Analysis", generatedAt: "2026-03-14T14:30:00Z", rubricSet: "Q1", status: "complete" },
    { id: "mock-3", title: "Q1 Analysis",      generatedAt: "2026-01-22T11:00:00Z", rubricSet: "Q1", status: "complete" },
  ]);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>("mock-1");
  const [isGenerating, setIsGenerating] = useState(false);

  function handleGenerateAnalysis() {
    if (isGenerating) return;
    setIsGenerating(true);
    const pendingId = `gen-${Date.now()}`;
    setAnalysisDocs((prev) => [
      { id: pendingId, title: `${activeQuarter} Analysis`, generatedAt: new Date().toISOString(), rubricSet: activeQuarter, status: "generating" },
      ...prev,
    ]);
    setSelectedAnalysisId(pendingId);
    setTimeout(() => {
      setAnalysisDocs((prev) =>
        prev.map((d) => d.id === pendingId ? { ...d, status: "complete" } : d)
      );
      setIsGenerating(false);
    }, 2500);
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  const selectedDoc = analysisDocs.find((d) => d.id === selectedAnalysisId) ?? null;

  /* ── Domain comparison ───────────────────────────────── */
  const [domainSeg, setDomainSeg] = useState<"school" | "dept" | "grade">("school");

  const domainCompData = useMemo(() => {
    if (!allTeachers.length || !allDomains.length) return null;

    type TD = { subject: string; grades: string[]; scores: Record<string, number> };
    const teacherData: TD[] = [];
    for (const t of allTeachers) {
      if (!t.observations?.length) continue;
      const last = t.observations[t.observations.length - 1];
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

    const belowThreshold = Object.values(schoolAvgs).filter((v) => v !== null && (v as number) < 0.7).length;

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
      queryClient.invalidateQueries({ queryKey: ["overdueObservations"] });
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
      const { reply } = await fetchAIChat(text, schoolId);
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
              actionCenterHref={`${baseUrl}/action-center`}
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
                { value: "analysis",     label: "Analysis",      icon: <TrendingUp  size={15} /> },
                ...(currentUser?.role === "NETWORK_LEADER" || currentUser?.role === "NETWORK_ADMIN"
                  ? [{ value: "report-generator", label: "Walkthrough Report Generator", icon: <FileText size={15} /> }]
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
                      style={{ color: schoolAvg !== null ? (schoolAvg >= 0.7 ? "#16a34a" : "#dc2626") : "#94a3b8",
                               fontFamily: "'Bebas Neue', sans-serif" }}
                    >
                      {schoolAvg !== null ? schoolAvg.toFixed(2) : "—"}
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
                              <th key={i} className={`px-4 py-2.5 text-white font-bold uppercase tracking-wider text-xs${i > 0 ? " text-right" : " text-left"}`}
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
                            const color  = avg === null ? "#94a3b8" : avg >= 0.7 ? "#15803d" : avg >= 0.5 ? "#b45309" : "#b91c1c";
                            const fillBg = avg === null ? "#cbd5e1" : avg >= 0.7 ? "#16a34a" : avg >= 0.5 ? "#d97706" : "#dc2626";
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
                        const clr   = val >= 0.7 ? "#15803d" : val >= 0.5 ? "#92400e" : "#b91c1c";
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
                                <th className="text-left px-4 py-2.5 text-white font-bold uppercase tracking-wider text-xs"
                                  style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", minWidth: 120 }}>Domain</th>
                                <th className="px-3 py-2.5 text-white font-bold uppercase tracking-wider text-xs text-center"
                                  style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", minWidth: 52 }}>School</th>
                                {segments.map((s) => (
                                  <th key={s} className="px-3 py-2.5 text-white font-bold uppercase tracking-wider text-xs text-center"
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
                      <span className="font-semibold text-slate-500">{allDomains.length}</span> domains below proficiency (0.70)
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
                                  className={`py-2.5 text-white font-bold uppercase tracking-wider text-xs${i === 0 ? " text-left px-4" : " text-center px-3"}`}
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
                              const schoolClr  = schoolVal  === null ? "#94a3b8" : schoolVal  >= 0.7 ? "#15803d" : schoolVal  >= 0.5 ? "#92400e" : "#b91c1c";
                              const networkClr = networkVal === null ? "#94a3b8" : networkVal >= 0.7 ? "#15803d" : networkVal >= 0.5 ? "#92400e" : "#b91c1c";
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
                ] as { key: "rescore" | "overdue" | "calibration"; label: string; count: number }[]
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
                      Teachers who received a walkthrough score below 0.7 and require a rescore within 14 days.
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
              TAB 3 — ANALYSIS (with sub-tabs)
          ════════════════════════════════════════════════════ */}
          <TabsContent value="analysis" className="flex-1 flex flex-col overflow-hidden mt-0">

            {/* ── Secondary sub-tab bar — matches Intervention style ── */}
            <div style={{ backgroundColor: "white", borderBottom: "1px solid #e2e8f0" }} className="px-4 sm:px-6 flex gap-6">
              {(
                [
                  { key: "analysis-summary", label: "Analysis Summary" },
                  { key: "data-assistant",   label: "Data Assistant"   },
                ] as { key: "analysis-summary" | "data-assistant"; label: string }[]
              ).map(({ key, label }) => {
                const active = analysisTab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setAnalysisTab(key)}
                    className="flex items-center gap-2 py-3 text-sm font-semibold transition-colors"
                    style={{
                      color:        active ? NAVY : "#64748b",
                      borderBottom: active ? `2px solid ${YELLOW}` : "2px solid transparent",
                      marginBottom: -1,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* ── Analysis Summary ── */}
            {analysisTab === "analysis-summary" && (
              <div className="flex-1 overflow-hidden flex min-h-0">

                {/* ── Left panel: list ── */}
                <div
                  className="flex flex-col shrink-0 overflow-hidden"
                  style={{ width: 300, borderRight: "1px solid #e2e8f0" }}
                >
                  {/* Generate button */}
                  <div className="p-4 shrink-0" style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <button
                      onClick={handleGenerateAnalysis}
                      disabled={isGenerating}
                      className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold transition-opacity disabled:opacity-60"
                      style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.04em" }}
                    >
                      {isGenerating ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />
                          Generating…
                        </>
                      ) : (
                        <>
                          <Sparkles size={14} color={YELLOW} />
                          Generate New Analysis
                        </>
                      )}
                    </button>
                    <p className="text-xs text-slate-400 mt-2 text-center leading-snug" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
                      Creates an AI-generated summary of current observation data
                    </p>
                  </div>

                  {/* Doc list */}
                  <div className="flex-1 overflow-y-auto">
                    {analysisDocs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center px-6 py-10">
                        <FileText size={28} style={{ color: "#cbd5e1" }} className="mb-3" />
                        <p className="text-sm text-slate-400" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
                          No analyses yet. Generate your first one above.
                        </p>
                      </div>
                    ) : (
                      analysisDocs.map((doc) => {
                        const isSelected = doc.id === selectedAnalysisId;
                        return (
                          <button
                            key={doc.id}
                            onClick={() => setSelectedAnalysisId(doc.id)}
                            className="w-full text-left flex items-start gap-3 px-4 py-3.5 transition-colors"
                            style={{
                              backgroundColor: isSelected ? "#EEF2FF" : "transparent",
                              borderBottom: "1px solid #f1f5f9",
                            }}
                          >
                            <div
                              className="mt-0.5 shrink-0 flex items-center justify-center rounded-lg w-8 h-8"
                              style={{ backgroundColor: isSelected ? NAVY : "#f1f5f9" }}
                            >
                              {doc.status === "generating"
                                ? <RefreshCw size={13} className="animate-spin" style={{ color: isSelected ? YELLOW : "#94a3b8" }} />
                                : <FileText size={13} style={{ color: isSelected ? YELLOW : "#64748b" }} />
                              }
                            </div>
                            <div className="min-w-0 flex-1">
                              <p
                                className="text-sm font-semibold leading-tight truncate"
                                style={{ color: isSelected ? NAVY : "#1e293b", fontFamily: "'Libre Franklin', sans-serif" }}
                              >
                                {doc.title}
                              </p>
                              <p className="text-xs mt-0.5" style={{ color: "#94a3b8", fontFamily: "'Libre Franklin', sans-serif" }}>
                                {fmtDate(doc.generatedAt)}
                              </p>
                              {doc.status === "generating" && (
                                <span
                                  className="inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: "#FEF9C3", color: "#A16207" }}
                                >
                                  Generating…
                                </span>
                              )}
                            </div>
                            <ChevronRight size={14} style={{ color: isSelected ? NAVY : "#cbd5e1", flexShrink: 0, marginTop: 2 }} />
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* ── Right panel: reader ── */}
                <div className="flex-1 overflow-y-auto">
                  {!selectedDoc ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-12">
                      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: "#EEF2FF" }}>
                        <FileText size={24} style={{ color: NAVY }} />
                      </div>
                      <p className="text-sm font-semibold text-slate-600">Select an analysis to view</p>
                      <p className="text-xs text-slate-400 mt-1">Or generate a new one from the panel on the left.</p>
                    </div>
                  ) : selectedDoc.status === "generating" ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-12">
                      <RefreshCw size={28} className="animate-spin mb-4" style={{ color: NAVY }} />
                      <p className="text-sm font-semibold text-slate-700">Generating analysis…</p>
                      <p className="text-xs text-slate-400 mt-1">The AI is reviewing your observation data. This will only take a moment.</p>
                    </div>
                  ) : (
                    <div className="max-w-2xl mx-auto px-6 py-6">

                      {/* Doc header */}
                      <div className="flex items-start justify-between gap-4 mb-6">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="text-xs font-bold px-2.5 py-0.5 rounded-full"
                              style={{ backgroundColor: "#EEF2FF", color: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", fontSize: 13 }}
                            >
                              {selectedDoc.rubricSet}
                            </span>
                            <span
                              className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                              style={{ backgroundColor: "#DCFCE7", color: "#15803D" }}
                            >
                              Complete
                            </span>
                          </div>
                          <h2
                            className="text-xl font-bold"
                            style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em", fontSize: 22 }}
                          >
                            {selectedDoc.title}
                          </h2>
                          <p className="text-xs text-slate-400 mt-0.5" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
                            Generated {fmtDate(selectedDoc.generatedAt)}
                          </p>
                        </div>
                        <button
                          className="shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:opacity-80"
                          style={{ border: "1.5px solid #e2e8f0", color: "#64748b", backgroundColor: "white" }}
                          title="Download (coming soon)"
                        >
                          <Download size={13} />
                          Export
                        </button>
                      </div>

                      {/* Placeholder sections */}
                      {[
                        {
                          label: "Executive Summary",
                          body: "AI-generated narrative summarizing the school's overall performance this period, key trends, and notable changes since the last observation cycle.",
                        },
                        {
                          label: "Domain Highlights",
                          body: "A breakdown of each rubric domain — identifying top-performing areas, domains with the most growth, and areas of persistent concern across the teacher population.",
                        },
                        {
                          label: "Teacher Growth Trends",
                          body: "Analysis of individual teacher trajectories, highlighting teachers who have crossed the 0.7 proficiency threshold, those plateauing, and those showing accelerated improvement.",
                        },
                        {
                          label: "Recommended Actions",
                          body: "Prioritized coaching and intervention recommendations based on the data patterns above, tailored to the school's current context and goals.",
                        },
                      ].map(({ label, body }) => (
                        <div key={label} className="mb-6">
                          <div
                            className="flex items-center gap-2 mb-2 pb-2"
                            style={{ borderBottom: `2px solid ${YELLOW}` }}
                          >
                            <h3
                              className="text-sm font-bold uppercase tracking-wide"
                              style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontSize: 15, letterSpacing: "0.06em" }}
                            >
                              {label}
                            </h3>
                          </div>
                          <div
                            className="rounded-lg px-4 py-3 text-sm leading-relaxed"
                            style={{ backgroundColor: "#f8fafc", color: "#94a3b8", fontStyle: "italic", fontFamily: "'Libre Franklin', sans-serif", border: "1.5px dashed #e2e8f0" }}
                          >
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold mb-1 not-italic" style={{ color: "#cbd5e1" }}>
                              <Sparkles size={11} /> AI-generated content
                            </span>
                            <p>{body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* ── Data Assistant ── */}
            {analysisTab === "data-assistant" && (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-4 sm:px-6 py-5 min-h-0">

                  {/* Header */}
                  <div className="flex items-center gap-3 mb-4 shrink-0">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm" style={{ backgroundColor: NAVY }}>
                      <Sparkles size={18} color={YELLOW} />
                    </div>
                    <div>
                      <h2 className="font-bold text-slate-800 text-base">GBF Data Assistant</h2>
                      <p className="text-xs text-slate-400">Ask questions about your school's observation data</p>
                    </div>
                    <Badge className="ml-auto text-xs font-bold px-2.5 py-1" style={{ backgroundColor: "#DCFCE7", color: "#15803D", border: "none" }}>
                      Live Data
                    </Badge>
                  </div>

                  {/* Message area */}
                  <ScrollArea className="flex-1 min-h-0 pr-1">
                    <div className="space-y-4 pb-2">
                      {chatMsgs.map((msg, i) => (
                        <div key={i} className={`flex items-start gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 shadow-sm"
                            style={{ backgroundColor: msg.role === "ai" ? NAVY : "#E2E8F0" }}
                          >
                            {msg.role === "ai" ? <Bot size={15} color="white" /> : <User2 size={15} color="#64748B" />}
                          </div>
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
                      {chatTyping && (
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: NAVY }}>
                            <Bot size={15} color="white" />
                          </div>
                          <div className="px-4 py-3 rounded-2xl bg-white shadow-sm border border-slate-200" style={{ borderRadius: "4px 18px 18px 18px" }}>
                            <div className="flex gap-1 items-center h-4">
                              {[0, 1, 2].map((d) => (
                                <div key={d} className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />
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
              </div>
            )}

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
          rubricSetAudience={activeQuarterAudience}
          freshStart
        />
      )}

    </div>
  );
}
