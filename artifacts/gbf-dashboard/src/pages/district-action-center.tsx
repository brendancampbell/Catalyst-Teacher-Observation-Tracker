import { useState, useRef, useEffect } from "react";
import {
  BarChart2, Sparkles, Activity, TrendingUp, TrendingDown,
  Flame, ShieldAlert, AlertTriangle, Building2, Users, Send, Bot, User2,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/UserContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

/* ── Dummy data ────────────────────────────────────────────── */

const NETWORK_TRENDS = [
  { pct: 42, insight: 'Across 4 schools, 42% of recent observations resulted in action steps related to "Sequential Directions" in Classroom Culture.' },
  { pct: 31, insight: 'Schools in the Newark region are outperforming the network average by 0.3 points in "The First 15" category.' },
  { pct: 27, insight: '"WTD Cycle" continues to be the lowest-scoring domain network-wide, with a mean score of 0.4 across all sites.' },
  { pct: 19, insight: '"Confident Presence" is the most consistently high-scoring domain — 3 of 4 schools score above the 0.7 threshold.' },
];

const SCHOOL_CALIBRATION_FLAGS = [
  { school: "Washington High",         domain: "WTD Cycle",                  internalAvg: 0.8, networkAvg: 0.5, delta: 0.3, direction: "over" },
  { school: "Lincoln Middle",           domain: "Ratio & Engagement",         internalAvg: 0.5, networkAvg: 0.5, delta: 0.0, direction: "none" },
  { school: "Roosevelt Elementary",     domain: "Academic Monitoring 101",    internalAvg: 0.7, networkAvg: 0.5, delta: 0.2, direction: "under" },
  { school: "Camden Academy",           domain: "Annotations & Notebook Habits", internalAvg: 1.0, networkAvg: 0.5, delta: 0.5, direction: "over" },
];

const RESCORE_QUEUE = [
  { school: "Washington High",       region: "NYC",      total: 8, overdue: 3 },
  { school: "Lincoln Middle",         region: "Newark",   total: 5, overdue: 1 },
  { school: "Roosevelt Elementary",   region: "Boston",   total: 3, overdue: 0 },
  { school: "Camden Academy",         region: "Camden",   total: 6, overdue: 4 },
];

const SCHOOL_SUPPORT_ALERTS = [
  {
    school: "Lincoln Middle",
    detail: "65% of staff stuck below 0.5 in \"WTD Cycle\" for 4+ weeks. Coaching cadence may need adjustment.",
    severity: "high",
    teachers: 12,
  },
  {
    school: "Washington High",
    detail: "9 teachers have shown no score improvement in \"Academic Monitoring 101\" across 3 consecutive observations.",
    severity: "high",
    teachers: 9,
  },
  {
    school: "Camden Academy",
    detail: "\"Annotations & Notebook Habits\" scores have declined 0.3 points on average since Q1.",
    severity: "medium",
    teachers: 7,
  },
  {
    school: "Roosevelt Elementary",
    detail: "3 teachers are on Growth Plateaus in \"Ratio & Engagement\" — no movement in 5 weeks.",
    severity: "medium",
    teachers: 3,
  },
];

type ChatMsg = { role: "user" | "ai"; text: string };

const SEED_CHAT: ChatMsg[] = [
  { role: "user", text: "How does Washington High compare to Lincoln Middle in Classroom Culture?" },
  {
    role: "ai",
    text: "Based on this quarter's walkthroughs, Washington High is outperforming Lincoln Middle by 0.6 points in Classroom Culture, largely driven by higher scores in \"Joy\" (1.0 vs 0.5) and \"Confident Presence\" (0.9 vs 0.6). Lincoln Middle's weakest area is \"WTD Cycle\" at 0.4.",
  },
  { role: "user", text: "Which schools need the most urgent support right now?" },
  {
    role: "ai",
    text: "Based on current data, Camden Academy and Washington High have the most overdue rescore items (4 and 3 respectively). Additionally, Lincoln Middle shows the largest concentration of Growth Plateau alerts — 12 teachers stuck below 0.5 in WTD Cycle for over 4 weeks. I'd recommend prioritizing a network walkthrough calibration session at those two sites.",
  },
  { role: "user", text: "What's our strongest domain network-wide this quarter?" },
  {
    role: "ai",
    text: "\"Confident Presence\" is the top-performing domain across the network with an average of 0.85. 3 of 4 schools exceed the 0.7 proficiency threshold in this domain. \"Joy\" follows closely at 0.82. These strengths are concentrated in ES and HS grade spans — MS schools show more variability.",
  },
];

/* ─────────────────────────────────────────────────────────── */

export default function DistrictActionCenterPage() {
  const { currentUser } = useUser();
  const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  /* ── Chat state ──────────────────────────────────────────── */
  const [chatMsgs,   setChatMsgs]   = useState<ChatMsg[]>(SEED_CHAT);
  const [chatInput,  setChatInput]  = useState("");
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
          text: "This is a placeholder response. In the live version, I'll analyze cross-school observation data and surface real network-wide insights here.",
        },
      ]);
    }, 1400);
  }

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      <Tabs defaultValue="summary" className="flex-1 flex flex-col">

        {/* ── Frozen top bar ─────────────────────────────── */}
        <div className="sticky top-0 z-30 flex flex-col shadow-md">

          {currentUser && (
            <AppHeader
              subtitle="Network Action Center"
              basePath={baseUrl}
              onAddObservation={() => { window.location.href = `${baseUrl}/`; }}
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

          {/* AI Disclaimer */}
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border"
            style={{ backgroundColor: "#FFFBEB", borderColor: "#FCD34D" }}>
            <Sparkles size={18} className="mt-0.5 shrink-0" style={{ color: "#D97706" }} />
            <p className="text-sm text-amber-800">
              <span className="font-bold">AI Features Coming Soon —</span> The cards below show placeholder data.
              Once connected to an AI model, this page will automatically synthesize cross-school observation data into real-time network insights.
            </p>
          </div>

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
                <div className="flex items-end gap-3">
                  <span
                    className="text-4xl font-bold tabular-nums"
                    style={{ color: "#16a34a", fontFamily: "'Bebas Neue', sans-serif" }}
                  >
                    0.7
                  </span>
                  <Badge className="mb-1 text-xs font-bold px-2 py-0.5"
                    style={{ backgroundColor: "#dcfce7", color: "#15803d", border: "none" }}>
                    Proficient
                  </Badge>
                </div>
                <p className="text-slate-400 text-xs mt-1">Across all schools, most recent observations</p>
                <p className="text-xs mt-1" style={{ color: "#94a3b8", fontStyle: "italic" }}>AI-synthesized · placeholder</p>
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
                <p
                  className="text-2xl font-bold leading-tight"
                  style={{ color: "#16a34a", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}
                >
                  Confident Presence
                </p>
                <p className="text-slate-500 text-sm mt-1">
                  Avg score <span className="font-bold text-green-600">0.85</span> across all schools
                </p>
                <p className="text-xs mt-1" style={{ color: "#94a3b8", fontStyle: "italic" }}>AI-synthesized · placeholder</p>
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
                <p
                  className="text-2xl font-bold leading-tight"
                  style={{ color: "#dc2626", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}
                >
                  WTD Cycle
                </p>
                <p className="text-slate-500 text-sm mt-1">
                  Avg score <span className="font-bold text-red-600">0.4</span> across all schools
                </p>
                <p className="text-xs mt-1" style={{ color: "#94a3b8", fontStyle: "italic" }}>AI-synthesized · placeholder</p>
              </CardContent>
            </Card>
          </div>

          {/* Network-Wide Trends + Calibration Flags */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Network-Wide Trends */}
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="px-5 pt-5 pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em", fontSize: 18 }}>
                  <Flame size={16} style={{ color: YELLOW }} />
                  Network-Wide Trends
                </CardTitle>
                <p className="text-xs text-slate-400 mt-0.5">Aggregated themes from recent observations · placeholder data</p>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-3">
                {NETWORK_TRENDS.map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span
                      className="shrink-0 font-bold text-xs px-2 py-1 rounded-md"
                      style={{ backgroundColor: "#EEF2FF", color: NAVY, minWidth: 40, textAlign: "center" }}
                    >
                      {item.pct}%
                    </span>
                    <p className="text-sm text-slate-600 leading-snug">{item.insight}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* School Calibration Flags */}
            <Card className="border-slate-200 shadow-sm" style={{ borderTop: `3px solid ${YELLOW}` }}>
              <CardHeader className="px-5 pt-5 pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: "#92400e", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em", fontSize: 18 }}>
                  <AlertTriangle size={16} style={{ color: YELLOW }} />
                  School Calibration Flags
                </CardTitle>
                <p className="text-xs text-amber-600 mt-0.5">
                  Score discrepancies between internal school grading and Network Walkthroughs · placeholder data
                </p>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-3">
                {SCHOOL_CALIBRATION_FLAGS.filter((f) => f.delta > 0).map((flag, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5"
                    style={{ backgroundColor: "#FFFBEB", border: "1px solid #FDE68A" }}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: NAVY }}>{flag.school}</p>
                      <p className="text-xs text-slate-500 truncate">{flag.domain}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs">
                      <span className="text-slate-500">
                        Internal <span className="font-bold text-slate-700">{flag.internalAvg.toFixed(1)}</span>
                      </span>
                      <span className="text-slate-300">vs</span>
                      <span className="text-slate-500">
                        Network <span className="font-bold text-slate-700">{flag.networkAvg.toFixed(1)}</span>
                      </span>
                      <Badge
                        className="font-bold text-xs px-2 py-0.5"
                        style={{
                          backgroundColor: flag.direction === "over" ? "#fee2e2" : "#fef3c7",
                          color: flag.direction === "over" ? "#b91c1c" : "#92400e",
                          border: "none",
                        }}
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
                  {RESCORE_QUEUE.reduce((s, r) => s + r.total, 0)} total pending
                </Badge>
              </div>
              <p className="text-xs text-slate-400 mt-1">Teachers across all schools awaiting walkthrough rescore review</p>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="overflow-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr style={{ backgroundColor: NAVY }}>
                      {["School", "Region", "Pending Rescores", "Overdue", "Status"].map((h) => (
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
                      <td colSpan={5} style={{ padding: 0, height: 3 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {RESCORE_QUEUE.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b transition-colors"
                        style={{ borderColor: "#e8edf8", backgroundColor: i % 2 === 0 ? "#ffffff" : "#f7f9fd" }}
                      >
                        <td className="px-4 py-3 font-semibold" style={{ color: NAVY }}>{row.school}</td>
                        <td className="px-4 py-3 text-slate-500">{row.region}</td>
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
            </CardContent>
          </Card>

          {/* School Support Alerts */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Flame size={18} style={{ color: "#ea580c" }} />
              <h2 className="font-bold text-lg" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em", fontSize: 20 }}>
                School Support Alerts
              </h2>
              <span className="text-slate-400 text-sm font-normal ml-1">Growth plateaus detected network-wide</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SCHOOL_SUPPORT_ALERTS.map((alert, i) => (
                <Card
                  key={i}
                  className="border shadow-sm"
                  style={{
                    borderColor: alert.severity === "high" ? "#fca5a5" : "#fde68a",
                    borderLeft: `4px solid ${alert.severity === "high" ? "#dc2626" : "#f59e0b"}`,
                  }}
                >
                  <CardContent className="px-4 py-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 size={14} style={{ color: NAVY, flexShrink: 0 }} />
                        <span className="font-bold text-sm truncate" style={{ color: NAVY }}>{alert.school}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge
                          className="text-xs font-bold px-2 py-0.5"
                          style={{
                            backgroundColor: alert.severity === "high" ? "#fee2e2" : "#fef3c7",
                            color: alert.severity === "high" ? "#b91c1c" : "#92400e",
                            border: "none",
                          }}
                        >
                          {alert.severity === "high" ? "High Priority" : "Medium Priority"}
                        </Badge>
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <Users size={11} />
                          {alert.teachers} teachers
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 leading-snug">{alert.detail}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 3 — NETWORK DATA ASSISTANT
        ════════════════════════════════════════════════════════ */}
        <TabsContent value="chat" className="flex-1 flex flex-col mt-0 overflow-hidden">
          <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 gap-0 overflow-hidden">

            {/* Header */}
            <div className="mb-4 shrink-0">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={18} style={{ color: NAVY }} />
                <h2 className="font-bold" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.02em" }}>
                  Network Data Assistant
                </h2>
              </div>
              <p className="text-sm text-slate-500">Ask cross-school comparative questions about your network's observation data.</p>
              <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                style={{ backgroundColor: "#FFFBEB", borderColor: "#FCD34D", border: "1px solid #FCD34D", color: "#92400e" }}>
                <Sparkles size={13} style={{ color: "#D97706", flexShrink: 0 }} />
                <span><strong>AI Coming Soon</strong> — Conversation below shows placeholder responses for UI preview purposes only.</span>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
              {chatMsgs.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "ai" && (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                      style={{ backgroundColor: NAVY }}
                    >
                      <Bot size={15} className="text-white" />
                    </div>
                  )}
                  <div
                    className="max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm"
                    style={
                      msg.role === "user"
                        ? { backgroundColor: NAVY, color: "white", borderBottomRightRadius: 4 }
                        : { backgroundColor: "white", color: "#1e293b", border: "1px solid #e2e8f0", borderBottomLeftRadius: 4 }
                    }
                  >
                    {msg.text}
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
                  <div className="px-4 py-3 rounded-2xl bg-white border border-slate-200 shadow-sm" style={{ borderBottomLeftRadius: 4 }}>
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
            <div className="shrink-0 pt-4 border-t border-slate-200 mt-4">
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
              <p className="text-center text-xs text-slate-400 mt-2">
                Placeholder UI — AI responses not yet connected
              </p>
            </div>
          </div>
        </TabsContent>

      </Tabs>

      {/* Footer */}
      <footer className="text-center py-4 shrink-0" style={{ borderTop: "1px solid #dde3f0", color: "#94a3b8", fontSize: 12, fontFamily: "'Libre Franklin', sans-serif" }}>
        &copy; 2026 Uncommon Schools, Inc. All rights reserved.
      </footer>
    </div>
  );
}
