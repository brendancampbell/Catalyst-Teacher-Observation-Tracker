import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { useLocation } from "wouter";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  fetchActionSteps,
  masterActionStep,
  fetchPeople,
  fetchDashboard,
  fetchRubricSets,
  createObservation,
} from "@/lib/api";
import type { ActionStep, CategoryEntry, DomainEntry, RubricSetRow } from "@/lib/api";
import type { Score, Teacher } from "@/data/dummy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AppHeader from "@/components/AppHeader";
import { NewObservationModal } from "@/components/NewObservationModal";
import { useUser } from "@/context/UserContext";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0]!;
}

function daysOverdue(dueDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  return Math.floor((today.getTime() - due.getTime()) / 86_400_000);
}

interface Props {
  employeeId: string;
  teacherName?: string;
}

export default function TeacherProfilePage({ employeeId, teacherName }: Props) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const { currentUser } = useUser();
  const schoolAbbreviation = new URLSearchParams(window.location.search).get("schoolAbbreviation") ?? currentUser?.schoolAbbreviation ?? null;

  /* ── Modal state ─────────────────────────────────────── */
  const [newObsOpen, setNewObsOpen] = useState(false);
  const [saving,     setSaving]     = useState(false);

  /* ── Action steps for this teacher ──────────────────── */
  const {
    data: actionSteps = [],
    isLoading,
    isError,
  } = useQuery<ActionStep[]>({
    queryKey: [...QUERY_KEYS.actionSteps, employeeId],
    queryFn:  () => fetchActionSteps(employeeId),
    staleTime: 30_000,
    enabled:   !!employeeId,
  });

  /* Resolve teacher name from the people list when the prop isn't supplied */
  const { data: resolvedName } = useQuery<string | undefined>({
    queryKey: [...QUERY_KEYS.personName, employeeId],
    queryFn:  async () => {
      const all   = await fetchPeople();
      const match = all.find((p) => p.employeeId === employeeId);
      return match ? `${match.firstName} ${match.lastName}`.trim() : undefined;
    },
    staleTime: 5 * 60_000,
    enabled:   !teacherName && !!employeeId,
  });

  const displayName = teacherName ?? resolvedName;

  /* ── Rubric sets (for modal) ─────────────────────────── */
  const { data: quarters = [] } = useQuery<RubricSetRow[]>({
    queryKey: QUERY_KEYS.quarters,
    queryFn:  () => fetchRubricSets(),
    staleTime: 60_000,
  });

  const activeQuarter   = quarters[0]?.slug ?? "Q1";
  const activeQuarterId = quarters[0]?.id   ?? 0;

  /* ── Dashboard data (teachers + rubric structure for modal) ── */
  const { data: dashData } = useQuery({
    queryKey: [...QUERY_KEYS.dashboard, activeQuarter, currentUser?.schoolId],
    queryFn:  () => fetchDashboard(activeQuarter, currentUser?.schoolId),
    staleTime: 60_000,
    enabled:   !!activeQuarter,
  });

  const allTeachers: Teacher[]      = dashData?.teachers   ?? [];
  const categories:  CategoryEntry[] = dashData?.categories ?? [];
  const allDomains:  DomainEntry[]   = categories.flatMap((c) => c.domains);

  /* ── Mark mastered ───────────────────────────────────── */
  const [masteringId, setMasteringId] = useState<number | null>(null);

  async function handleMaster(id: number) {
    setMasteringId(id);
    try {
      await masterActionStep(id);
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.actionSteps, employeeId] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.overdueActionSteps });
    } catch { /* silent */ }
    finally { setMasteringId(null); }
  }

  /* ── Submit observation from modal ───────────────────── */
  async function handleSubmitObs(
    teacherId:            string,
    date:                 string,
    scores:               Record<string, Score>,
    strengths:            string,
    growthAreas:          string,
    isWalkthrough:        boolean,
    time:                 string,
    course:               string,
    _draftId?:            string,
    newActionStep?:       { text: string; dueDate: string },
    masterActionStepId?:  number,
  ): Promise<string> {
    setSaving(true);
    try {
      const obs = await createObservation({
        teacherId,
        rubricSetId:        activeQuarterId,
        date,
        time:               time        || undefined,
        course:             course      || undefined,
        scores,
        strengths:          strengths   || undefined,
        growthAreas:        growthAreas || undefined,
        observer:           currentUser?.name ?? "Unknown",
        observerId:         currentUser?.id,
        isWalkthrough,
        newActionStep,
        masterActionStepId,
      });
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.actionSteps, employeeId] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.overdueActionSteps });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
      return obs.id;
    } catch (err) {
      console.error("Failed to save observation:", err);
      return "";
    } finally {
      setSaving(false);
    }
  }

  const today      = todayIso();
  const openSteps  = actionSteps.filter((s) => s.status === "open");
  const masteredSteps = actionSteps.filter((s) => s.status === "mastered");

  const returnUrl = encodeURIComponent(`/teacher/${employeeId}`);

  return (
    <div
      className="h-full overflow-hidden flex flex-col"
      style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}
    >
      <AppHeader
        backHref={`${baseUrl}/action-center`}
        backLabel="Action Center"
        schoolAbbreviation={schoolAbbreviation}
        basePath={baseUrl}
        onAddObservation={() => setNewObsOpen(true)}
        draftsHref={`${baseUrl}/drafts?returnUrl=${returnUrl}`}
        actionCenterHref={`${baseUrl}/action-center`}
        userName={currentUser?.name ?? ""}
        userEmail={currentUser?.email}
        userRole={currentUser?.role ?? "SCHOOL_LEADER"}
        canAdmin={currentUser?.role !== "COACH"}
      />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin" style={{ color: NAVY }} />
          </div>
        ) : isError ? (
          <Card className="border-red-200">
            <CardContent className="flex items-center gap-3 py-6 text-red-700">
              <AlertCircle size={20} />
              <p className="font-semibold">Failed to load action steps. Please refresh.</p>
            </CardContent>
          </Card>
        ) : actionSteps.length === 0 ? (
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center py-14 gap-3">
              <CheckCircle2 size={48} className="text-green-400" />
              <div className="text-center">
                <p className="font-bold text-lg" style={{ color: NAVY }}>No action steps yet</p>
                <p className="text-slate-500 text-sm mt-1">
                  Action steps assigned during observations will appear here.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {openSteps.length > 0 && (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-3">
                  <CardTitle
                    className="text-base font-bold flex items-center gap-2"
                    style={{ color: NAVY }}
                  >
                    <AlertCircle size={16} style={{ color: YELLOW }} />
                    Open Action Steps
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}
                    >
                      {openSteps.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  {openSteps.map((step) => {
                    const overdue  = step.dueDate < today;
                    const days     = overdue ? daysOverdue(step.dueDate) : 0;
                    const mastering = masteringId === step.id;
                    return (
                      <div
                        key={step.id}
                        className="rounded-lg border p-4 space-y-2"
                        style={{
                          borderColor:       overdue ? "#fca5a5" : "#e2e8f0",
                          backgroundColor:   overdue ? "#FFF5F5" : "white",
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-800 flex-1 leading-snug">
                            {step.text}
                          </p>
                          {overdue && (
                            <span
                              className="shrink-0 text-xs font-bold px-2 py-1 rounded-full"
                              style={{ backgroundColor: "#FEE2E2", color: "#B91C1C" }}
                            >
                              Overdue {days}d
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>
                            Due:{" "}
                            <span className="font-semibold text-slate-700">
                              {formatDate(step.dueDate)}
                            </span>
                          </span>
                          {step.assignedByName && (
                            <span>
                              Assigned by:{" "}
                              <span className="font-semibold text-slate-700">
                                {step.assignedByName}
                              </span>
                            </span>
                          )}
                          <span>
                            Assigned:{" "}
                            <span className="font-semibold text-slate-700">
                              {formatDate(step.createdAt.split("T")[0]!)}
                            </span>
                          </span>
                        </div>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => handleMaster(step.id)}
                            disabled={mastering}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-50"
                            style={{ backgroundColor: "#16a34a", color: "white" }}
                          >
                            {mastering ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={12} />
                            )}
                            {mastering ? "Marking…" : "Mark Mastered"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {masteredSteps.length > 0 && (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-3">
                  <CardTitle
                    className="text-base font-bold flex items-center gap-2"
                    style={{ color: NAVY }}
                  >
                    <CheckCircle2 size={16} className="text-green-500" />
                    Mastered Action Steps
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "#DCFCE7", color: "#15803D" }}
                    >
                      {masteredSteps.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  {masteredSteps.map((step) => (
                    <div
                      key={step.id}
                      className="rounded-lg border border-green-100 bg-green-50 p-4 space-y-2"
                    >
                      <p className="text-sm font-semibold text-slate-700 leading-snug">
                        {step.text}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span className="font-bold text-green-700">✓ Mastered</span>
                        {step.masteredAt && (
                          <span>
                            on{" "}
                            <span className="font-semibold text-slate-700">
                              {formatDate(step.masteredAt.split("T")[0]!)}
                            </span>
                          </span>
                        )}
                        {step.masteredByName && (
                          <span>
                            by{" "}
                            <span className="font-semibold text-slate-700">
                              {step.masteredByName}
                            </span>
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                        {step.assignedByName && (
                          <span>Assigned by: {step.assignedByName}</span>
                        )}
                        <span>Assigned: {formatDate(step.createdAt.split("T")[0]!)}</span>
                        <span>Due was: {formatDate(step.dueDate)}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* New Observation Modal */}
      <NewObservationModal
        teachers={allTeachers}
        categories={categories}
        allDomains={allDomains}
        open={newObsOpen}
        onOpenChange={setNewObsOpen}
        canMarkWalkthrough={true}
        defaultTeacherId={employeeId}
        observerName={currentUser?.name}
        rubricSetId={activeQuarterId || undefined}
        onSubmit={handleSubmitObs}
        saving={saving}
        freshStart
      />
    </div>
  );
}
