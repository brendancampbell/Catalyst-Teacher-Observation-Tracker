import { useEffect, useMemo, useState } from "react";
import { actionCenterHref } from "@/lib/school-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { canEditObservation } from "@/lib/observation-permissions";
import { removeObservationFromDashboards } from "@/lib/observation-cache";
import { toast } from "@/hooks/use-toast";
import { School, User, CheckCircle2, Clock, AlertCircle, RotateCcw, X } from "lucide-react";
import { type Teacher, type Observation } from "@/data/dummy";
import { fetchDashboard, updateObservation, deleteObservation, fetchActionSteps, masterActionStep, unmasterActionStep, type ActionStep, type CategoryEntry, type RubricSetRow } from "@/lib/api";
import { calcOverallAvgFromScores } from "@/lib/utils";
import { rubricSetsForTeacher } from "@/lib/subject-audience";
import { ObservationCard } from "@/components/ObservationCard";
import { DomainScorePanel, RecentFeedbackCards, domainScoreRows } from "@/components/DomainScorePanel";
import { useUser } from "@/context/UserContext";
import { ObservationDetailModal } from "@/components/ObservationDetailModal";
import AppHeader from "@/components/AppHeader";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

interface ActionStepsDrawerProps {
  open: boolean;
  onClose: () => void;
  actionSteps: ActionStep[];
  canEdit: boolean;
  masteringId: number | null;
  handleMasterStep: (id: number) => void;
  handleUnmasterStep: (id: number) => void;
}

function ActionStepsDrawer({ open, onClose, actionSteps, canEdit, masteringId, handleMasterStep, handleUnmasterStep }: ActionStepsDrawerProps) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const openSteps = actionSteps.filter((s) => s.status === "open");
  const masteredSteps = actionSteps.filter((s) => s.status === "mastered");

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white z-50 shadow-2xl flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Action Steps"
      >
        <div
          className="px-5 py-4 flex items-center justify-between gap-2 shrink-0"
          style={{ borderBottom: `3px solid ${NAVY}`, borderLeft: `4px solid ${YELLOW}` }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} style={{ color: NAVY }} />
            <h2
              className="font-bold uppercase tracking-wide"
              style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontSize: 20, letterSpacing: "0.02em" }}
            >
              Action Steps
            </h2>
            <span
              className="text-sm font-semibold rounded-full px-2.5 py-0.5"
              style={{ backgroundColor: YELLOW, color: NAVY }}
            >
              {actionSteps.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {actionSteps.length === 0 && (
            <p className="text-sm text-slate-400 italic py-2">No action steps recorded yet.</p>
          )}

          {openSteps.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Open</p>
              <div className="space-y-3">
                {openSteps.map((step) => {
                  const isOverdue = step.dueDate < todayIso;
                  return (
                    <div
                      key={step.id}
                      className="bg-white rounded-xl shadow-sm px-4 py-3 space-y-2"
                      style={{ border: isOverdue ? "1.5px solid #FCA5A5" : "1px solid #dde3f0" }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <AlertCircle size={14} className={isOverdue ? "text-red-500" : "text-amber-500"} />
                          {isOverdue && (
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "#FEE2E2", color: "#B91C1C" }}>
                              Overdue
                            </span>
                          )}
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            disabled={masteringId === step.id}
                            onClick={() => handleMasterStep(step.id)}
                            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded transition-colors disabled:opacity-50"
                            style={{ backgroundColor: "#DCFCE7", color: "#15803D" }}
                          >
                            <CheckCircle2 size={13} />
                            {masteringId === step.id ? "Saving…" : "Mark Mastered"}
                          </button>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-800 leading-snug">{step.text}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                        <span>Assigned: <span className="font-semibold text-slate-700">{new Date(step.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></span>
                        <span>Due: <span className={`font-semibold ${isOverdue ? "text-red-600" : "text-slate-700"}`}>{(() => { const [y, m, d] = step.dueDate.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); })()}</span></span>
                        {step.assignedByName && <span>Assigned By: <span className="font-semibold text-slate-700">{step.assignedByName}</span></span>}
                        <ExtensionNote count={step.extensionCount} originalDueDate={step.originalDueDate} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {masteredSteps.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Mastered</p>
              <div className="space-y-3">
                {masteredSteps.map((step) => (
                  <div
                    key={step.id}
                    className="bg-white rounded-xl shadow-sm px-4 py-3 space-y-2"
                    style={{ border: "1.5px solid #86EFAC" }}
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-green-600" />
                      <span className="text-xs font-bold uppercase tracking-wider text-green-700">Mastered</span>
                    </div>
                    <p className="text-sm font-medium text-slate-700 leading-snug line-through decoration-green-400">{step.text}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                      <span>Assigned: <span className="font-semibold text-slate-700">{new Date(step.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></span>
                      {step.assignedByName && <span>Assigned By: <span className="font-semibold text-slate-700">{step.assignedByName}</span></span>}
                      <span>Due: <span className="font-semibold text-slate-700">{(() => { const [y, m, d] = step.dueDate.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); })()}</span></span>
                      {step.masteredAt && (
                        <span>Mastered: <span className="font-semibold text-green-700">{new Date(step.masteredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></span>
                      )}
                      {step.masteredByName && <span>Marked as Mastered By: <span className="font-semibold text-green-700">{step.masteredByName}</span></span>}
                    </div>
                    {/* Mastery used to be one-way: marking it was a click, and
                        editing a mastered step is refused, so a misclick could
                        not be undone from the interface at all. */}
                    {canEdit && (
                      <button
                        type="button"
                        disabled={masteringId === step.id}
                        onClick={() => handleUnmasterStep(step.id)}
                        className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded transition-colors disabled:opacity-50"
                        style={{ backgroundColor: "#F1F5F9", color: "#475569" }}
                      >
                        <RotateCcw size={13} /> Undo mastered
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

interface ActionStepsCardProps {
  actionSteps: ActionStep[];
  loading: boolean;
  onClick: () => void;
}

function ActionStepsCard({ actionSteps, loading, onClick }: ActionStepsCardProps) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const openSteps = actionSteps.filter((s) => s.status === "open");
  const preview = openSteps.length > 0
    ? [...openSteps].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : actionSteps.length > 0
    ? [...actionSteps].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : null;

  return (
    <div
      className="bg-white rounded-xl shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
      style={{ border: "1px solid #dde3f0" }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      aria-label="Open Action Steps"
    >
      <div
        className="px-4 py-3 flex items-center justify-between gap-2"
        style={{ borderBottom: `3px solid ${NAVY}`, borderLeft: `4px solid ${YELLOW}` }}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} style={{ color: NAVY }} />
          <h2
            className="font-bold uppercase tracking-wide"
            style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontSize: 18, letterSpacing: "0.02em" }}
          >
            Most Recent Action Step
          </h2>
        </div>
        {!loading && (
          <span
            className="text-sm font-semibold rounded-full px-2.5 py-0.5"
            style={{ backgroundColor: YELLOW, color: NAVY }}
          >
            {actionSteps.length}
          </span>
        )}
      </div>

      <div className="px-4 py-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Clock size={14} className="animate-spin" /> Loading…
          </div>
        )}
        {!loading && !preview && (
          <p className="text-sm text-slate-400 italic">No action steps yet.</p>
        )}
        {!loading && preview && (() => {
          const isOpen = preview.status === "open";
          const isOverdue = isOpen && preview.dueDate < todayIso;
          return (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {isOpen
                  ? <AlertCircle size={13} className={isOverdue ? "text-red-500" : "text-amber-500"} />
                  : <CheckCircle2 size={13} className="text-green-600" />}
                <span
                  className="text-xs font-bold uppercase tracking-wide"
                  style={{ color: isOpen ? (isOverdue ? "#B91C1C" : "#92400E") : "#15803D" }}
                >
                  {isOpen ? (isOverdue ? "Overdue" : "Open") : "Mastered"}
                </span>
              </div>
              <p className={`text-sm font-semibold text-slate-800 leading-snug${!isOpen ? " line-through decoration-green-400" : ""}`}>
                {preview.text}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                <span>Due: <span className={`font-semibold ${isOverdue ? "text-red-600" : "text-slate-700"}`}>{(() => { const [y, m, d] = preview.dueDate.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); })()}</span></span>
                {preview.assignedByName && <span>Assigned By: <span className="font-semibold text-slate-700">{preview.assignedByName}</span></span>}
              </div>
              <p className="text-xs text-slate-400 mt-1">Tap to see all action steps →</p>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

interface Props {
  teacher: Teacher;
  onBack: () => void;
  onNewObs: () => void;
  rubricSets: RubricSetRow[];
  initialRubricSet: string;
  initialCategories: CategoryEntry[];
  schoolId?: number | null;
  /* Everyone the observation could be reassigned to. Same school only — the
     server enforces that, and the dashboard only ever holds one school's
     teachers anyway. */
  reassignableTeachers?: { id: string; name: string }[];
}

/**
 * "Extended 2× · originally due 3 Oct" — shown under an action step whose due
 * date has been pushed back.
 *
 * Without it, extending would quietly erase the fact that a teacher has been
 * working on the same thing since October: the row would just show the newest
 * date, looking like a step assigned last week. Repeated extensions are the
 * signal that somebody is stuck, which is the whole reason they are recorded.
 */
function ExtensionNote({ count, originalDueDate }: { count?: number; originalDueDate?: string }) {
  if (!count || count < 1 || !originalDueDate) return null;
  const [y, m, d] = originalDueDate.split("-").map(Number);
  const original = new Date(y!, m! - 1, d!).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <span style={{ color: "#B45309" }}>
      Extended {count}&times; &middot; originally due <span className="font-semibold">{original}</span>
    </span>
  );
}

export function TeacherScoreOverlay({ teacher, onBack, onNewObs, rubricSets, initialRubricSet, initialCategories, schoolId, reassignableTeachers }: Props) {
  const { currentUser } = useUser();
  const queryClient = useQueryClient();

  /* ── Role-based edit permission ───────────────────────────────── */
  /* The role half, and all the action-step drawer needs: mastering a step is
     about leading the school, not about who wrote the observation. */
  const canEdit =
    currentUser?.role === "SCHOOL_LEADER" ||
    currentUser?.role === "NETWORK_LEADER" ||
    currentUser?.role === "NETWORK_ADMIN";

  /* ── Observation modal state ──────────────────────────────────── */
  const [selectedObservation, setSelectedObservation] = useState<Observation | null>(null);
  const [localObsOverrides, setLocalObsOverrides] = useState<Record<string, Observation>>({});

  /* ── Action Steps drawer ──────────────────────────────────────── */
  const [actionStepsDrawerOpen, setActionStepsDrawerOpen] = useState(false);

  /* ── Action Steps ─────────────────────────────────────────────── */
  const {
    data: actionSteps = [],
    isLoading: actionStepsLoading,
  } = useQuery<ActionStep[]>({
    queryKey: [...QUERY_KEYS.actionSteps, teacher.employeeId],
    queryFn:  () => fetchActionSteps(teacher.employeeId!),
    enabled:  !!teacher.employeeId,
    staleTime: 30_000,
  });
  const [masteringId, setMasteringId] = useState<number | null>(null);


  async function handleMasterStep(stepId: number) {
    setMasteringId(stepId);
    try {
      await masterActionStep(stepId);
      queryClient.setQueryData(
        [...QUERY_KEYS.actionSteps, teacher.employeeId],
        (prev: ActionStep[] | undefined) =>
          (prev ?? []).map((s) =>
            s.id === stepId
              ? { ...s, status: "mastered" as const, masteredAt: new Date().toISOString() }
              : s,
          ),
      );
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.actionSteps, teacher.employeeId] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.latestActionSteps });
    } catch {
      toast({ title: "Could not mark step as mastered", variant: "destructive" });
    } finally {
      setMasteringId(null);
    }
  }

  /*
   * Undo a mastery.
   *
   * A quiet revert, not a recorded event: this exists to fix a misclick, so
   * the step goes back to exactly how it was. That includes its original due
   * date, which may put it straight back on the overdue list — correct, since
   * undoing a mastery means the work was never finished.
   */
  async function handleUnmasterStep(stepId: number) {
    setMasteringId(stepId);
    try {
      await unmasterActionStep(stepId);
      queryClient.setQueryData(
        [...QUERY_KEYS.actionSteps, teacher.employeeId],
        (prev: ActionStep[] | undefined) =>
          (prev ?? []).map((s) =>
            s.id === stepId
              ? { ...s, status: "open" as const, masteredAt: undefined, masteredByName: undefined }
              : s,
          ),
      );
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.actionSteps, teacher.employeeId] });
      /* It may be overdue again, so the Action Center has to re-read. */
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.latestActionSteps });
    } catch {
      toast({ title: "Could not undo mastery", variant: "destructive" });
    } finally {
      setMasteringId(null);
    }
  }

  /* ── Rubric switching ─────────────────────────────────────────── */
  const [selectedRubricSlug, setSelectedRubricSlug] = useState(initialRubricSet);

  /*
   * Rubrics this teacher can actually be scored on.
   *
   * Two filters, applied in two places, because they answer different
   * questions. The caller has already removed school-wide rubrics and ones for
   * the wrong grade span — both properties of the SCHOOL, so the dashboard
   * settles them once. What is left is per-teacher: a STEM rubric belongs only
   * on a STEM teacher's profile.
   *
   * Teachers with no subject, or one that is neither STEM nor Humanities (Art,
   * PE, Music), match only rubrics marked for all subjects. That is how the
   * dashboard's teacher list already behaves, so the two agree.
   */
  const applicableRubricSets = useMemo(
    () => rubricSetsForTeacher(rubricSets, teacher.subject),
    [rubricSets, teacher.subject],
  );

  /*
   * Should not happen by the normal route: you reach a profile from a
   * dashboard already filtered to a rubric, and that dashboard only lists
   * teachers the rubric applies to. It can still happen from a direct link, so
   * fall back to the first rubric that does apply rather than showing scores
   * from one that does not.
   */
  useEffect(() => {
    if (applicableRubricSets.length === 0) return;
    if (applicableRubricSets.some((rs) => rs.slug === selectedRubricSlug)) return;
    setSelectedRubricSlug(applicableRubricSets[0]!.slug);
  }, [applicableRubricSets, selectedRubricSlug]);

  const isInitialRubric = selectedRubricSlug === initialRubricSet;

  const { data: altData, isFetching: altFetching } = useQuery({
    queryKey: [...QUERY_KEYS.dashboard, selectedRubricSlug, schoolId ?? null],
    queryFn: () => fetchDashboard(selectedRubricSlug, schoolId ?? null),
    enabled: !isInitialRubric,
    staleTime: 60_000,
  });

  const activeCategories: CategoryEntry[] = isInitialRubric
    ? initialCategories
    : (altData?.categories ?? initialCategories);

  const activeTeacher: Teacher = isInitialRubric
    ? teacher
    : (altData?.teachers.find((t) => t.id === teacher.id) ?? teacher);

  const sortedObs = useMemo(
    () =>
      [...activeTeacher.observations]
        .map((o) => localObsOverrides[o.id] ?? o)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [activeTeacher, localObsOverrides],
  );

  const recent = sortedObs[0];

  const allScores = useMemo(
    () => domainScoreRows(activeCategories, activeTeacher.observations),
    [activeTeacher, activeCategories],
  );

  /* Most-recent score for a specific domain — walks observations newest→oldest,
     returns the first observation that actually scored this domain. */
  function getMostRecentDomainScore(domainId: string): number | null {
    for (const obs of sortedObs) {
      const score = obs.scores[domainId];
      if (score !== undefined) return score as number;
    }
    return null;
  }

  /* Build a merged per-domain scores map using the per-domain-latest-across-history
     logic (same as Dashboard), then feed it to calcOverallAvgFromScores. */
  const mergedDomainScores: Record<string, number | undefined> = {};
  for (const cat of activeCategories) {
    for (const domain of cat.domains) {
      const score = getMostRecentDomainScore(domain.id);
      if (score !== null) mergedDomainScores[domain.id] = score;
    }
  }

  const overallAvg = activeCategories.length
    ? calcOverallAvgFromScores(mergedDomainScores, activeCategories)
    : null;

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const backHref = (() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("teacher");
    const qs = params.toString();
    return window.location.pathname + (qs ? "?" + qs : "");
  })();
  const schoolDisplayName =
    new URLSearchParams(window.location.search).get("schoolName") ??
    currentUser?.schoolName ?? "";

  return (
    <div className="h-full overflow-y-auto flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* ── Top bar ──────────────────────────────────────── */}
      <div className="sticky top-0 z-30 shadow-md">
        {currentUser && (
          <AppHeader
            subtitle={teacher.name}
            backHref={backHref}
            backLabel={schoolDisplayName || "Dashboard"}
            basePath={basePath}
            onAddObservation={onNewObs}
            actionCenterHref={actionCenterHref(basePath, backHref, schoolId)}
            userName={currentUser.name}
            userEmail={currentUser.email}
            userRole={currentUser.role}
            canAdmin={currentUser.role !== "COACH"}
          />
        )}
      </div>

      {/* ── Page body ─────────────────────────────────────── */}
      <main className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-4 sm:gap-5 flex-1">

        {/* Teacher hero card */}
        <div
          className="rounded-xl overflow-hidden shadow-sm"
          style={{ border: "1px solid #dde3f0" }}
        >
          <div className="px-4 sm:px-6 py-4 sm:py-5" style={{ backgroundColor: NAVY }}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div
                    className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-base sm:text-lg font-bold shrink-0"
                    style={{ backgroundColor: YELLOW, color: NAVY, fontFamily: "'Bebas Neue', sans-serif" }}
                  >
                    {[teacher.firstName?.[0], teacher.lastName?.[0]].filter(Boolean).join("") || teacher.name.split(" ").map((n) => n[0]).join("")}
                  </div>
                  <div>
                    <h1
                      className="text-white font-bold leading-tight"
                      style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: "0.02em" }}
                    >
                      {teacher.name}
                    </h1>
                    {(teacher.subject || teacher.gradeLevel.length > 0) && (
                      <p className="text-blue-200 text-sm font-medium">
                        {[
                          teacher.subject || null,
                          teacher.gradeLevel.length > 0
                            ? `Grade${teacher.gradeLevel.length !== 1 ? "s" : ""} ${teacher.gradeLevel.join(", ")}`
                            : null,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {teacher.email && (
                      <a
                        href={`mailto:${teacher.email}`}
                        className="text-xs font-medium mt-0.5 hover:text-white transition-colors"
                        style={{ color: "rgba(147,197,253,0.85)", textDecoration: "none" }}
                      >
                        {teacher.email}
                      </a>
                    )}
                  </div>
                </div>

                {/* ── Rubric selector ─── */}
                {applicableRubricSets.length === 0 && (
                  <p className="mt-3" style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
                    No rubric applies to this teacher &mdash; check their department and grade level.
                  </p>
                )}
                {applicableRubricSets.length > 1 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {applicableRubricSets.map((rs) => {
                      const isActive = rs.slug === selectedRubricSlug;
                      return (
                        <button
                          key={rs.slug}
                          onClick={() => setSelectedRubricSlug(rs.slug)}
                          className="flex items-center gap-1.5 px-3 py-1 rounded-full transition-all"
                          style={{
                            fontFamily: "'Bebas Neue', sans-serif",
                            fontSize: 13,
                            letterSpacing: "0.04em",
                            fontWeight: 700,
                            backgroundColor: isActive ? YELLOW : "rgba(255,255,255,0.12)",
                            color: isActive ? NAVY : "rgba(255,255,255,0.85)",
                            border: isActive ? "none" : "1px solid rgba(255,255,255,0.2)",
                            opacity: altFetching && !isActive ? 0.5 : 1,
                          }}
                        >
                          {rs.target === "SCHOOL" ? <School size={11} /> : <User size={11} />}
                          {rs.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex gap-2 sm:gap-3 flex-wrap">
                <div
                  className="text-center rounded-lg px-4 py-2.5 min-w-[80px]"
                  style={{ backgroundColor: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.15)" }}
                >
                  <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Current Avg</p>
                  <p
                    className="font-bold mt-0.5"
                    style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 800, fontSize: 30, color: YELLOW, lineHeight: 1 }}
                  >
                    {overallAvg !== null ? overallAvg.toFixed(1) : "—"}
                  </p>
                </div>
                <div
                  className="text-center rounded-lg px-4 py-2.5 min-w-[80px]"
                  style={{ backgroundColor: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.15)" }}
                >
                  <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Observations</p>
                  <p
                    className="font-bold text-white mt-0.5"
                    style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 800, fontSize: 30, lineHeight: 1 }}
                  >
                    {activeTeacher.observations.length}
                  </p>
                </div>
                {recent && (() => {
                  const daysSince = Math.floor(
                    (Date.now() - new Date(recent.date + "T00:00:00").getTime()) / 86_400_000
                  );
                  return (
                    <div
                      className="text-center rounded-lg px-4 py-2.5 min-w-[90px]"
                      style={{ backgroundColor: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.15)" }}
                    >
                      <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Last Observed</p>
                      <p
                        className="font-bold text-white mt-0.5 leading-none"
                        style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 800, fontSize: 30 }}
                      >
                        {daysSince}
                        <span className="text-base font-semibold ml-0.5">d</span>
                      </p>
                      <p className="text-blue-200 text-xs mt-1">{formatDate(recent.date)}</p>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-5">

          {/* LEFT: Domain score breakdown */}
          <div className="lg:col-span-3 space-y-4">
            <DomainScorePanel categories={activeCategories} allScores={allScores} />
          </div>

          {/* RIGHT: Action Steps → Glows → Grows */}
          <div className="lg:col-span-2 space-y-4">
            {teacher.employeeId && (
              <ActionStepsCard
                actionSteps={actionSteps}
                loading={actionStepsLoading}
                onClick={() => setActionStepsDrawerOpen(true)}
              />
            )}
            {recent && (
              <>
                <RecentFeedbackCards recent={recent} />
              </>
            )}
          </div>
        </div>

        {/* Full observation history */}
        <div>
          <h2
            className="font-bold uppercase tracking-wide mb-3"
            style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontSize: 22, letterSpacing: "0.02em" }}
          >
            Observation History
            <span
              className="ml-3 text-base font-semibold rounded-full px-2.5 py-0.5"
              style={{ backgroundColor: YELLOW, color: NAVY }}
            >
              {sortedObs.length}
            </span>
          </h2>
          <div className="space-y-4">
            {sortedObs.map((obs, i) => (
              <ObservationCard
                key={obs.id}
                obs={obs}
                index={i}
                categories={activeCategories}
                onClick={() => setSelectedObservation(obs)}
              />
            ))}
          </div>
        </div>

      </main>

      {/* ── Action Steps drawer ───────────────────────────── */}
      <ActionStepsDrawer
        open={actionStepsDrawerOpen}
        onClose={() => setActionStepsDrawerOpen(false)}
        actionSteps={actionSteps}
        canEdit={canEdit}
        masteringId={masteringId}
        handleMasterStep={handleMasterStep}
        handleUnmasterStep={handleUnmasterStep}
      />

      {/* ── Observation detail modal ──────────────────────── */}
      {selectedObservation && (() => {
        const shown = localObsOverrides[selectedObservation.id] ?? selectedObservation;
        const canEditThisObs = canEditObservation(shown, currentUser);
        return (
        <ObservationDetailModal
          reassignableTeachers={reassignableTeachers}
          teacher={activeTeacher}
          priorObservations={activeTeacher.observations}
          observation={localObsOverrides[selectedObservation.id] ?? selectedObservation}
          categories={activeCategories}
          /* Per observation, not per person — canEdit above is the role half,
             and stays as it is for the action-step drawer, which is a
             different right. */
          canEdit={canEditThisObs}
          open={!!selectedObservation}
          onOpenChange={(open) => { if (!open) setSelectedObservation(null); }}
          onSave={async (updated) => {
            const saved = await updateObservation(updated.id, {
              strengths:   updated.strengths,
              growthAreas: updated.growthAreas,
              scores:      updated.scores,
              date:          updated.date,
              time:          updated.time ?? null,
              isWalkthrough: updated.isWalkthrough,
              ...(updated.observedEmployeeId
                ? { observedEmployeeId: updated.observedEmployeeId }
                : {}),
              /* The first action step for an observation filed without one. */
              ...(updated.newActionStep ? { newActionStep: updated.newActionStep } : {}),
            });
            setLocalObsOverrides((prev) => ({ ...prev, [saved.id]: saved }));
            setSelectedObservation(saved);
            await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
            await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.latestActionSteps });
            await queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.actionSteps, teacher.employeeId] });
          }}
          onDelete={canEditThisObs ? async (observationId) => {
            await deleteObservation(observationId, true);
            setLocalObsOverrides((prev) => {
              const next = { ...prev };
              delete next[observationId];
              return next;
            });
            setSelectedObservation(null);
            /* Off the screen now, not one round trip from now. The invalidate
               below still runs; this is what makes it disappear immediately. */
            removeObservationFromDashboards(queryClient, observationId);
            await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
            await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.latestActionSteps });
            await queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.actionSteps, teacher.employeeId] });
          } : undefined}
        />
        );
      })()}
    </div>
  );
}
