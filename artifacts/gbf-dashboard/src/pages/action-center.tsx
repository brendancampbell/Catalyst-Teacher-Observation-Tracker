import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Plus } from "lucide-react";
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

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

function getDueStatus(dueDateStr: string | null): { label: string; color: string; urgent: boolean } {
  if (!dueDateStr) return { label: "No due date", color: "#94a3b8", urgent: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + "T00:00:00");
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: `Overdue by ${Math.abs(diffDays)}d`, color: "#dc2626", urgent: true };
  if (diffDays === 0) return { label: "Due today", color: "#ea580c", urgent: true };
  if (diffDays <= 3) return { label: `Due in ${diffDays}d`, color: "#ea580c", urgent: true };
  return { label: `Due in ${diffDays}d`, color: "#16a34a", urgent: false };
}

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

  /* ── Data for New Observation modal ─────────────────── */
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

  /* ── Add-Observation modal state ────────────────────── */
  const [addObsTeacherId,    setAddObsTeacherId]    = useState<string | null>(null);
  const [newObsOpen,         setNewObsOpen]          = useState(false);
  const [newObsIsWalkthrough, setNewObsIsWalkthrough] = useState(false);
  const [saving, setSaving]                          = useState(false);

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
        quarterId:    activeQuarterId,
        date,
        scores,
        strengths:    strengths  || undefined,
        growthAreas:  growthAreas || undefined,
        observer:     currentUser?.name ?? "Unknown",
        observerId:   currentUser?.id,
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

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* Yellow accent bar */}
      <div style={{ height: 5, backgroundColor: YELLOW }} />

      {/* Header */}
      <header style={{ backgroundColor: NAVY }} className="sticky top-0 z-30 shrink-0 shadow-md">
        <div className="px-3 sm:px-5 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 sm:gap-5 min-w-0">
            <img
              src="/uncommon-logo.png"
              alt="Uncommon Schools"
              className="h-8 sm:h-12 w-auto object-contain shrink-0"
              style={{ filter: "brightness(0) invert(1)" }}
            />
            <div className="hidden sm:block" style={{ width: 1, height: 40, backgroundColor: "rgba(255,181,0,0.45)" }} />
            <div className="hidden sm:block min-w-0">
              <a
                href={`${baseUrl}/`}
                className="flex items-center gap-1 mb-0.5 text-blue-200 hover:text-yellow-300 transition-colors"
                style={{ fontSize: 12, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}
              >
                <ArrowLeft size={12} />
                Back to Dashboard
              </a>
              <p
                className="text-white uppercase tracking-widest leading-tight"
                style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "0.04em" }}
              >
                Action Center
              </p>
              <p className="text-blue-200 font-medium" style={{ fontSize: 14 }}>
                Rescore Queue
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded px-2 sm:px-3 py-1.5" style={{ backgroundColor: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }}>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: YELLOW, color: NAVY }}
              >
                {currentUser?.name.split(" ").map((w) => w[0]).slice(0, 2).join("") ?? "…"}
              </div>
              <span className="text-white font-medium hidden sm:block" style={{ fontSize: 15 }}>
                {currentUser?.name ?? "Loading…"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 px-3 sm:px-5 py-5 sm:py-7 max-w-6xl mx-auto w-full space-y-5">

        {/* Page title + count */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1
              className="text-2xl font-bold uppercase tracking-wider"
              style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em" }}
            >
              Rescore Queue
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Teachers who received a walkthrough score below 0.7 and require a rescore observation within 14 days.
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

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: NAVY }} />
          </div>
        ) : isError ? (
          <div className="text-center py-20 text-red-500 font-semibold">
            Failed to load rescore queue. Please refresh.
          </div>
        ) : queue.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center py-20 gap-4">
            <CheckCircle2 size={56} className="text-green-400" />
            <div className="text-center">
              <p className="font-bold text-lg" style={{ color: NAVY }}>All clear!</p>
              <p className="text-slate-500 text-sm mt-1">No teachers currently require rescoring.</p>
            </div>
          </div>
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
                        <td className="px-4 py-3 text-slate-600">
                          {item.schoolName ?? "—"}
                        </td>
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
                            style={{
                              backgroundColor: NAVY,
                              color: "white",
                              fontFamily: "'Bebas Neue', sans-serif",
                              letterSpacing: "0.03em",
                              fontSize: 13,
                            }}
                          >
                            <Plus size={13} />
                            Score Rescore
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

      </main>

      <footer className="text-center py-4" style={{ borderTop: "1px solid #dde3f0", color: "#94a3b8", fontSize: 12, fontFamily: "'Libre Franklin', sans-serif" }}>
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
          canMarkWalkthrough={currentUser?.role === "DISTRICT_ADMIN" || currentUser?.role === "PRINCIPAL"}
          defaultTeacherId={addObsTeacherId ?? undefined}
          defaultIsWalkthrough={newObsIsWalkthrough}
          onSubmit={handleSubmitObs}
          saving={saving}
        />
      )}

    </div>
  );
}
