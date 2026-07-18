import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useApp } from "@/context/AppContext";
import { AppHeader } from "@/components/AppHeader";
import {
  apiFetch,
  Teacher,
  RubricCategory,
  Score,
  DraftObservation,
  ActionStep,
  createObservation,
  updateObservation,
  fetchMyDrafts,
} from "@/lib/api";
import { teacherMatchesAudience } from "@/lib/subject-audience";
import { isNetworkScope } from "@/lib/roles";
import { CheckCircle, Loader2, AlertCircle, ChevronDown, FileEdit, CloudOff, RefreshCw } from "lucide-react";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

const SCORE_OPTIONS: { value: Score; label: string }[] = [
  { value: 0, label: "Not Yet" },
  { value: 0.5, label: "Developing" },
  { value: 1, label: "Proficient" },
];

function scorePillStyle(value: Score, selected: boolean): React.CSSProperties {
  if (!selected) return { backgroundColor: "#f1f5f9", color: "#94a3b8", border: "1px solid #e2e8f0" };
  if (value >= 1) return { backgroundColor: "#16a34a", color: "#ffffff", border: "2px solid #15803d" };
  if (value >= 0.5) return { backgroundColor: "#fde68a", color: "#92400e", border: "2px solid #fbbf24" };
  return { backgroundColor: "#fca5a5", color: "#991b1b", border: "2px solid #f87171" };
}

interface RubricData {
  rubricSet: { id: number; slug: string; name: string };
  categories: RubricCategory[];
}

export function localDraftKey(userId: string | number | undefined, rubricSetId: number | undefined, teacherId: string | undefined): string {
  return `catalyst-mobile-draft-${userId ?? "anon"}-${rubricSetId ?? "0"}-${teacherId ?? "0"}`;
}

export interface LocalDraft {
  teacherId: string;
  date: string;
  course: string;
  scores: Partial<Record<string, Score>>;
  strengths: string;
  growthAreas: string;
  isWalkthrough: boolean;
  actionStepText: string;
  actionStepDueDate: string;
  masterActionStepId: number | null;
  savedAt: number;
}

export default function ObservationPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { selectedSchool, selectedRubric, setSelectedSchool } = useApp();
  const [, navigate] = useLocation();
  const search = useSearch();


  const effectiveSchoolId = selectedSchool?.id ?? user?.schoolId ?? null;

  const networkScope = isNetworkScope(user);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/"); return; }
    if (networkScope && !selectedSchool) { navigate("/school-picker"); return; }
    if (!selectedRubric) { navigate("/rubric-picker"); return; }
  }, [user, authLoading, selectedSchool, selectedRubric, networkScope]);

  const { data: teachers, isLoading: loadingTeachers, isError: errorTeachers } = useQuery<Teacher[]>({
    queryKey: ["teachers", effectiveSchoolId],
    queryFn: async () => {
      const params = new URLSearchParams({ includeInFeedbackTracker: "true" });
      if (effectiveSchoolId != null) params.set("schoolId", String(effectiveSchoolId));
      const all = await apiFetch<(Teacher & { employeeId: string })[]>(`/api/people?${params}`);
      return all.filter((t) => t.isActive).map((t) => ({ ...t, id: t.employeeId }));
    },
    enabled: !!user,
  });

  const { data: rubricData, isLoading: loadingRubric, isError: errorRubric } = useQuery<RubricData>({
    queryKey: ["rubric", selectedRubric?.slug],
    queryFn: () => apiFetch<RubricData>(`/api/rubric/${selectedRubric!.slug}`),
    enabled: !!selectedRubric,
  });

  const todayIso = new Date().toISOString().split("T")[0];
  const [teacherId, setTeacherId] = useState<string>("");
  const [date, setDate] = useState(todayIso);
  const [course, setCourse] = useState("");
  const [scores, setScores] = useState<Partial<Record<string, Score>>>({});
  const [strengths, setStrengths] = useState("");
  const [growthAreas, setGrowthAreas] = useState("");
  const [isWalkthrough, setIsWalkthrough] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /* ── Action step state ──────────────────────────────────────────── */
  const [lastActionStep, setLastActionStep] = useState<ActionStep | null>(null);
  const [loadingLastActionStep, setLoadingLastActionStep] = useState(false);
  const [markMastered, setMarkMastered] = useState(false);
  const [actionStepText, setActionStepText] = useState("");
  const [actionStepDueDate, setActionStepDueDate] = useState("");
  const [actionStepDueDateError, setActionStepDueDateError] = useState<string | null>(null);

  const [draftId, setDraftId] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [localDraftRestored, setLocalDraftRestored] = useState(false);
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  const [draftCheckDone, setDraftCheckDone] = useState(false);

  const [pendingTeacherId, setPendingTeacherId] = useState<string | null>(null);
  const [switchConfirmOpen, setSwitchConfirmOpen] = useState(false);
  const [savingBeforeSwitch, setSavingBeforeSwitch] = useState(false);
  const [switchSaveError, setSwitchSaveError] = useState<string | null>(null);

  const draftIdRef = useRef<string | null>(null);
  const draftJustLoaded = useRef(false);
  const isSubmittingRef = useRef(false);

  const strengthsRef = useRef<HTMLTextAreaElement | null>(null);
  const growthAreasRef = useRef<HTMLTextAreaElement | null>(null);
  const actionStepTextRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = strengthsRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [strengths]);

  useEffect(() => {
    const el = growthAreasRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [growthAreas]);

  useEffect(() => {
    const el = actionStepTextRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [actionStepText]);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { draftIdRef.current = draftId; }, [draftId]);

  const audience = selectedRubric?.subjectAudience ?? "ALL";
  const filteredTeachers = useMemo(
    () => teachers?.filter((t) => teacherMatchesAudience(t.department, audience)) ?? [],
    [teachers, audience],
  );
  const hiddenByAudience = useMemo(() => {
    if (audience === "ALL" || !teachers) return 0;
    return teachers.filter((t) => !teacherMatchesAudience(t.department, audience)).length;
  }, [teachers, audience]);

  useEffect(() => {
    if (filteredTeachers.length > 0 && !teacherId) {
      setTeacherId(filteredTeachers[0].id);
    }
  }, [filteredTeachers]);

  useEffect(() => {
    if (filteredTeachers.length > 0 && !filteredTeachers.find((t) => t.id === teacherId)) {
      setTeacherId(filteredTeachers[0].id);
    }
  }, [filteredTeachers, teacherId]);

  const allDomains = rubricData?.categories.flatMap((c) => c.domains) ?? [];
  const scoredCount = allDomains.filter((d) => scores[d.slug] !== undefined).length;

  /* ── Fetch last action step on teacher change ───────────────────── */
  const fetchLastActionStep = useCallback(async (tid: string) => {
    if (!tid) return;
    setLoadingLastActionStep(true);
    setLastActionStep(null);
    setMarkMastered(false);
    try {
      const result = await apiFetch<ActionStep | null>(
        `/api/action-steps/latest?teacherEmployeeId=${encodeURIComponent(tid)}`,
      );
      setLastActionStep(result);
    } catch {
      setLastActionStep(null);
    } finally {
      setLoadingLastActionStep(false);
    }
  }, []);

  function loadDraftIntoForm(draft: DraftObservation) {
    draftJustLoaded.current = true;
    setDate(draft.date);
    setCourse(draft.course ?? "");
    setScores(draft.scores as Partial<Record<string, Score>>);
    setStrengths(draft.strengths ?? "");
    setGrowthAreas(draft.growthAreas ?? "");
    setActionStepText(draft.actionStepText ?? "");
    setActionStepDueDate(draft.actionStepDueDate ?? "");
    setIsWalkthrough(draft.isWalkthrough);
    setDraftId(draft.id);
    setAutoSaveStatus("saved");
    setLastSavedTime(null);
    setLocalDraftRestored(false);
  }

  const checkForDraft = useCallback(async (forTeacherId: string, rubricSetId: number) => {
    if (!forTeacherId) return;
    try {
      const allDrafts = await fetchMyDrafts();
      const match = allDrafts.find(
        (d) => d.observedEmployeeId === forTeacherId && d.rubricSetId === rubricSetId,
      );
      if (match) {
        loadDraftIntoForm(match);
        return;
      }
    } catch {
      /* silently ignore — draft detection is best-effort */
    }

    const lsKey = localDraftKey(user?.id, rubricSetId, forTeacherId);
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        const ld = JSON.parse(raw) as LocalDraft;
        if (ld.teacherId === forTeacherId) {
          draftJustLoaded.current = true;
          setDate(ld.date);
          setCourse(ld.course);
          setScores(ld.scores);
          setStrengths(ld.strengths);
          setGrowthAreas(ld.growthAreas);
          setIsWalkthrough(ld.isWalkthrough);
          setActionStepText(ld.actionStepText ?? "");
          setActionStepDueDate(ld.actionStepDueDate ?? "");
          setMarkMastered(ld.masterActionStepId != null);
          setLocalDraftRestored(true);
        }
      }
    } catch { /* ignore */ }
  }, [user?.id]);

  const resumeDraftIdParam = new URLSearchParams(search).get("draftId");

  const loadDraftById = useCallback(async (id: string) => {
    try {
      const allDrafts = await fetchMyDrafts();
      const match = allDrafts.find((d) => d.id === id);
      if (match) {
        loadDraftIntoForm(match);
      } else {
        setDraftLoadError(
          "This observation could not be loaded — it may belong to a different school or has been deleted.",
        );
      }
    } catch {
      setDraftLoadError("Failed to load the requested observation. Please try again.");
    } finally {
      setDraftCheckDone(true);
    }
  }, []);

  useEffect(() => {
    if (resumeDraftIdParam && rubricData) {
      loadDraftById(resumeDraftIdParam);
    }
  }, [resumeDraftIdParam, rubricData]);

  useEffect(() => {
    if (!teacherId || !selectedRubric?.id || resumeDraftIdParam) return;
    /* Prevent the autosave effect from writing stale form values (from the
       previous teacher) into the new teacher's localStorage key before this
       effect's setState calls have been committed.  The autosave effect checks
       this same flag and skips one cycle when it is true. */
    draftJustLoaded.current = true;
    setDate(todayIso);
    setCourse("");
    setScores({});
    setStrengths("");
    setGrowthAreas("");
    setIsWalkthrough(false);
    setDraftId(null);
    setAutoSaveStatus("idle");
    setLastSavedTime(null);
    setLocalDraftRestored(false);
    setActionStepText("");
    setActionStepDueDate("");
    setActionStepDueDateError(null);
    setMarkMastered(false);
    checkForDraft(teacherId, selectedRubric.id);
    fetchLastActionStep(teacherId);
  }, [teacherId]);

  /* ── Action step validation ─────────────────────────────────────── */
  const hasActionStepText = actionStepText.trim().length > 0;
  const hasActionStepDate = actionStepDueDate.length > 0;
  const actionStepPartiallyFilled = hasActionStepText || hasActionStepDate;

  function validateActionStepDueDate(dueDateVal: string): string | null {
    if (!dueDateVal) return null;
    if (dueDateVal < todayIso!) return "Due date must be today or later.";
    return null;
  }

  function handleActionStepDueDateChange(val: string) {
    setActionStepDueDate(val);
    setActionStepDueDateError(validateActionStepDueDate(val));
  }

  function handleRepeatLast() {
    if (!lastActionStep) return;
    setActionStepText(lastActionStep.text);
    setActionStepDueDate(lastActionStep.dueDate);
    const err = validateActionStepDueDate(lastActionStep.dueDate);
    setActionStepDueDateError(err);
  }

  const scoresJson = JSON.stringify(scores);
  useEffect(() => {
    if (!teacherId || !selectedRubric?.id || isSubmittingRef.current) return;
    /* Always clear the one-shot guard first so it is never left set when the
       form happens to be empty (e.g. switching to a teacher with no draft). */
    if (draftJustLoaded.current) {
      draftJustLoaded.current = false;
      return;
    }

    const hasContent =
      Object.keys(scores).length > 0 ||
      strengths.trim().length > 0 ||
      growthAreas.trim().length > 0 ||
      actionStepText.trim().length > 0 ||
      actionStepDueDate.length > 0;
    if (!hasContent) return;

    const masterActionStepId =
      markMastered && lastActionStep?.status === "open" ? lastActionStep.id : null;

    const lsKey = localDraftKey(user?.id, selectedRubric.id, teacherId);
    const lsDraft: LocalDraft = {
      teacherId,
      date,
      course,
      scores,
      strengths,
      growthAreas,
      isWalkthrough,
      actionStepText,
      actionStepDueDate,
      masterActionStepId,
      savedAt: Date.now(),
    };
    try { localStorage.setItem(lsKey, JSON.stringify(lsDraft)); } catch { /* ignore */ }

    setAutoSaveStatus("saving");

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    const newActionStepDraft =
      actionStepText.trim().length > 0 && actionStepDueDate.length > 0
        ? { text: actionStepText.trim(), dueDate: actionStepDueDate }
        : undefined;

    const timer = setTimeout(async () => {
      if (isSubmittingRef.current) return;
      try {
        const currentDraftId = draftIdRef.current;
        const scoresRecord = scores as Record<string, Score>;
        let savedId: string;
        if (currentDraftId) {
          const obs = await updateObservation(currentDraftId, {
            strengths: strengths || undefined,
            growthAreas: growthAreas || undefined,
            scores: scoresRecord,
            status: "draft",
            newActionStep: newActionStepDraft,
            masterActionStepId: masterActionStepId ?? undefined,
          });
          savedId = obs.id;
        } else {
          const obs = await createObservation({
            teacherId,
            rubricSetId: selectedRubric.id,
            date,
            course: course || undefined,
            scores: scoresRecord,
            strengths: strengths || undefined,
            growthAreas: growthAreas || undefined,
            observer: user?.name,
            observerId: user?.id != null ? Number(user.id) : undefined,
            isWalkthrough,
            status: "draft",
            newActionStep: newActionStepDraft,
            masterActionStepId: masterActionStepId ?? undefined,
          });
          savedId = obs.id;
          setDraftId(savedId);
        }
        const now = new Date();
        const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        setAutoSaveStatus("saved");
        setLastSavedTime(t);
        setLocalDraftRestored(false);
      } catch {
        setAutoSaveStatus("error");
      }
    }, 2000);

    autoSaveTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      autoSaveTimerRef.current = null;
    };
  }, [teacherId, date, course, scoresJson, strengths, growthAreas, isWalkthrough, actionStepText, actionStepDueDate, markMastered]);

  function hasFormContent(): boolean {
    return (
      Object.keys(scores).length > 0 ||
      strengths.trim().length > 0 ||
      growthAreas.trim().length > 0 ||
      actionStepText.trim().length > 0 ||
      actionStepDueDate.length > 0
    );
  }

  function handleTeacherChange(newTeacherId: string) {
    if (newTeacherId === teacherId) return;
    if (hasFormContent()) {
      setPendingTeacherId(newTeacherId);
      setSwitchConfirmOpen(true);
    } else {
      setTeacherId(newTeacherId);
    }
  }

  async function confirmSwitch() {
    if (!pendingTeacherId || !selectedRubric) return;
    setSavingBeforeSwitch(true);
    setSwitchSaveError(null);
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    try {
      const currentDraftId = draftIdRef.current;
      const masterActionStepId =
        markMastered && lastActionStep?.status === "open" ? lastActionStep.id : null;
      const newActionStepDraft =
        actionStepText.trim().length > 0 && actionStepDueDate.length > 0
          ? { text: actionStepText.trim(), dueDate: actionStepDueDate }
          : undefined;
      if (currentDraftId) {
        await updateObservation(currentDraftId, {
          strengths: strengths || undefined,
          growthAreas: growthAreas || undefined,
          scores: scores as Record<string, Score>,
          status: "draft",
          newActionStep: newActionStepDraft,
          masterActionStepId: masterActionStepId ?? undefined,
        });
      } else {
        const obs = await createObservation({
          teacherId,
          rubricSetId: selectedRubric.id,
          date,
          course: course || undefined,
          scores: scores as Record<string, Score>,
          strengths: strengths || undefined,
          growthAreas: growthAreas || undefined,
          observer: user?.name,
          observerId: user?.id != null ? Number(user.id) : undefined,
          isWalkthrough,
          status: "draft",
          newActionStep: newActionStepDraft,
          masterActionStepId: masterActionStepId ?? undefined,
        });
        draftIdRef.current = obs.id;
        setDraftId(obs.id);
      }
      /* Save succeeded — now safe to switch */
      setSavingBeforeSwitch(false);
      setSwitchConfirmOpen(false);
      const next = pendingTeacherId;
      setPendingTeacherId(null);
      setTeacherId(next);
    } catch (err) {
      /* Save failed — keep user on current teacher, surface the error */
      setSavingBeforeSwitch(false);
      const msg = err instanceof Error ? err.message : "Failed to save draft";
      setSwitchSaveError(`Couldn't save your draft: ${msg}. Please retry before switching.`);
    }
  }

  function cancelSwitch() {
    setSwitchConfirmOpen(false);
    setPendingTeacherId(null);
    setSwitchSaveError(null);
  }

  function clearLocalDraft() {
    if (!user?.id || !selectedRubric?.id) return;
    try { localStorage.removeItem(localDraftKey(user.id, selectedRubric.id, teacherId)); } catch { /* ignore */ }
  }

  function resetForm() {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    isSubmittingRef.current = false;
    setDraftId(null);
    setAutoSaveStatus("idle");
    setLastSavedTime(null);
    setLocalDraftRestored(false);
    setTeacherId(filteredTeachers[0]?.id ?? "");
    setDate(new Date().toISOString().split("T")[0]);
    setCourse("");
    setScores({});
    setStrengths("");
    setGrowthAreas("");
    setIsWalkthrough(false);
    setActionStepText("");
    setActionStepDueDate("");
    setActionStepDueDateError(null);
    setMarkMastered(false);
    setLastActionStep(null);
    setSubmitError(null);
  }

  async function doSubmit() {
    if (!teacherId || !selectedRubric) return;

    /* Validate action step fields before submitting */
    if (actionStepPartiallyFilled) {
      if (!hasActionStepText) {
        setSubmitError("Please enter an action step description, or clear the due date.");
        return;
      }
      if (!hasActionStepDate) {
        setSubmitError("Please enter a due date for the action step.");
        return;
      }
      const dueDateErr = validateActionStepDueDate(actionStepDueDate);
      if (dueDateErr) {
        setActionStepDueDateError(dueDateErr);
        setSubmitError("Action step due date must be today or later.");
        return;
      }
    }

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setSaving(true);
    isSubmittingRef.current = true;
    setSubmitError(null);

    const newActionStepPayload =
      hasActionStepText && hasActionStepDate
        ? { text: actionStepText.trim(), dueDate: actionStepDueDate }
        : undefined;

    const masterActionStepIdPayload =
      markMastered && lastActionStep?.status === "open" ? lastActionStep.id : undefined;

    try {
      const currentDraftId = draftIdRef.current;
      if (currentDraftId) {
        await updateObservation(currentDraftId, {
          strengths: strengths || undefined,
          growthAreas: growthAreas || undefined,
          scores: scores as Record<string, Score>,
          status: "published",
          newActionStep: newActionStepPayload,
          masterActionStepId: masterActionStepIdPayload,
        });
      } else {
        await apiFetch("/api/observations", {
          method: "POST",
          body: JSON.stringify({
            observedEmployeeId: teacherId,
            rubricSetId: selectedRubric.id,
            date,
            course: course || null,
            strengths: strengths || null,
            growthAreas: growthAreas || null,
            scores: Object.fromEntries(Object.entries(scores).filter(([, v]) => v !== undefined)),
            isWalkthrough,
            newActionStep: newActionStepPayload,
            masterActionStepId: masterActionStepIdPayload,
          }),
        });
      }
      clearLocalDraft();
      setConfirmed(true);
      setTimeout(() => {
        setConfirmed(false);
        resetForm();
      }, 2500);
    } catch (err: unknown) {
      const base = err instanceof Error ? err.message : "Failed to save observation";
      const masteryNote = masterActionStepIdPayload != null
        ? " The 'Mark as Mastered' flag was not saved — it is still checked and will be re-sent when you retry."
        : "";
      setSubmitError(base + masteryNote);
      isSubmittingRef.current = false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!teacherId || !selectedRubric) return;
    await doSubmit();
  }

  function handleSwitchSchool() {
    setSelectedSchool(null);
    navigate("/school-picker");
  }

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const schoolName = selectedSchool?.displayName ?? user?.schoolName ?? undefined;
  const subtitle = [schoolName, selectedRubric?.name].filter(Boolean).join(" · ");

  const isLoading = loadingTeachers || loadingRubric;
  const isError = errorTeachers || errorRubric;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <AppHeader
        subtitle={subtitle}
        onSwitchSchool={networkScope ? handleSwitchSchool : undefined}
      />

      {/* Confirmation overlay */}
      {confirmed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="bg-white rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-3 w-full max-w-xs">
            <CheckCircle size={40} style={{ color: "#16a34a" }} />
            <p className="font-bold text-slate-800 text-base" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: NAVY, letterSpacing: 1 }}>
              Observation Saved!
            </p>
            <p className="text-sm text-slate-500 text-center">The form will reset for your next observation.</p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-32">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 size={28} className="animate-spin" style={{ color: NAVY }} />
            <p className="text-sm text-slate-500">Loading form…</p>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
            <AlertCircle size={32} className="text-red-400" />
            <p className="text-sm font-semibold text-red-500">Failed to load observation form</p>
          </div>
        )}

        {draftLoadError && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 px-6 text-center">
            <AlertCircle size={40} className="text-red-400" />
            <div>
              <p className="text-sm font-semibold text-red-600 mb-1">Observation Not Accessible</p>
              <p className="text-sm text-slate-500">{draftLoadError}</p>
            </div>
            <button
              type="button"
              onClick={() => { setDraftLoadError(null); navigate(`${basePath}/drafts`); }}
              className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: NAVY }}
            >
              Back to My Drafts
            </button>
          </div>
        )}

        {!isLoading && !isError && !draftLoadError && (!resumeDraftIdParam || draftCheckDone) && teachers && rubricData && (
          <form id="obs-form" onSubmit={handleSubmit} className="px-4 pt-4 flex flex-col gap-4">

            {/* No-teachers notice */}
            {filteredTeachers.length === 0 && audience !== "ALL" && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
                <AlertCircle size={18} className="shrink-0 mt-0.5 text-amber-500" />
                <p className="text-sm text-amber-800 leading-snug">
                  No teachers match this rubric's audience. Switch to an All-audience rubric or update teacher subjects.
                </p>
              </div>
            )}

            {/* Hidden-teachers notice */}
            {hiddenByAudience > 0 && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl border" style={{ backgroundColor: "#FFF8E6", borderColor: "#F5C842" }}>
                <AlertCircle size={18} className="shrink-0 mt-0.5" style={{ color: "#B45309" }} />
                <p className="text-sm leading-snug" style={{ color: "#7A5C00" }}>
                  {hiddenByAudience === 1 ? "1 teacher is hidden" : `${hiddenByAudience} teachers are hidden`}
                  {" — this rubric is for "}
                  <strong>{audience === "STEM" ? "STEM" : "Humanities"}</strong>
                  {" teachers only. Switch to an "}
                  <strong>All Teachers</strong>
                  {" rubric to see everyone."}
                </p>
              </div>
            )}

            {/* Local-only draft banner */}
            {localDraftRestored && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50">
                <CloudOff size={18} className="shrink-0 mt-0.5 text-amber-600" />
                <p className="text-sm text-amber-800 leading-snug">
                  Restored from a local backup (saved before a sync error). Continue editing — it will sync now.
                </p>
              </div>
            )}

            {/* Teacher + Date */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Teacher</label>
                <div className="relative">
                  <select
                    value={teacherId}
                    onChange={(e) => handleTeacherChange(e.target.value)}
                    required
                    disabled={filteredTeachers.length === 0}
                    className="w-full appearance-none px-3 py-2.5 pr-9 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 bg-white text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ fontFamily: "'Libre Franklin', sans-serif" }}
                  >
                    <option value="" disabled>Select a teacher…</option>
                    {filteredTeachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.department ?? ""}{ t.department && t.gradeLevel?.length ? ", " : ""}{t.gradeLevel?.length ? `Gr. ${t.gradeLevel.join("/")}` : ""})
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div className="min-w-0">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Observation Date
                </label>
                <div className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-blue-500">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className="w-full min-w-0 px-3 py-2.5 text-sm focus:outline-none bg-white text-slate-800"
                    style={{ boxSizing: "border-box", border: "none", display: "block" }}
                  />
                </div>
              </div>
            </div>

            {/* Subject / Course */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Subject / Course Being Observed
              </label>
              <input
                type="text"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                placeholder="e.g. AP Biology, 8th Grade Math, ELA Block 2…"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 bg-white text-slate-800"
                style={{ fontFamily: "'Libre Franklin', sans-serif" }}
              />
            </div>


            {/* Progress bar */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: allDomains.length ? `${(scoredCount / allDomains.length) * 100}%` : "0%",
                    backgroundColor: scoredCount === allDomains.length && allDomains.length > 0 ? "#16a34a" : NAVY,
                  }}
                />
              </div>
              <span
                className="text-xs font-semibold shrink-0"
                style={{ color: scoredCount === allDomains.length && allDomains.length > 0 ? "#16a34a" : "#64748b" }}
              >
                {scoredCount} / {allDomains.length} scored
              </span>
            </div>

            {/* Score legend */}
            <div className="flex items-center gap-2 flex-wrap text-xs font-semibold">
              <span className="text-slate-400 uppercase tracking-wide text-xs">Scale:</span>
              {SCORE_OPTIONS.map(({ value, label }) => (
                <span
                  key={value}
                  className="px-2.5 py-0.5 rounded"
                  style={scorePillStyle(value, true)}
                >
                  {value === 0 ? "0" : value === 1 ? "1" : "0.5"} · {label}
                </span>
              ))}
            </div>

            {/* Domain scores per category */}
            {rubricData.categories.map((cat) => (
              <div key={cat.id} className="overflow-hidden rounded-xl shadow-sm border border-slate-100">
                <div
                  className="px-4 py-2.5 font-bold uppercase tracking-wider text-white"
                  style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.04em" }}
                >
                  {cat.name}
                </div>
                <div className="bg-white divide-y divide-slate-100">
                  {cat.domains.map((domain) => (
                    <div key={domain.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-700">{domain.name}</p>
                        {domain.description && (
                          <p className="text-xs text-slate-400 mt-0.5 leading-snug">{domain.description}</p>
                        )}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {SCORE_OPTIONS.map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            title={label}
                            onClick={() => setScores((prev) => ({ ...prev, [domain.slug]: prev[domain.slug] === value ? undefined : value }))}
                            className="px-2.5 h-9 rounded font-bold text-sm transition-all whitespace-nowrap min-w-[36px]"
                            style={scorePillStyle(value, scores[domain.slug] === value)}
                          >
                            {value === 0 ? "0" : value === 1 ? "1" : "0.5"}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Notes */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: "#16a34a" }}>
                  ✦ Teacher Strengths (Glows)
                </label>
                <textarea
                  ref={(el) => {
                    strengthsRef.current = el;
                    if (el) {
                      el.style.height = "auto";
                      el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
                    }
                  }}
                  value={strengths}
                  onChange={(e) => {
                    setStrengths(e.target.value);
                  }}
                  placeholder="What is this teacher doing well?"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm resize-none overflow-hidden focus:outline-none focus:ring-2 focus:ring-green-300 bg-white text-slate-800"
                  style={{ minHeight: 80 }}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: "#ea580c" }}>
                  ↑ Growth Areas (Grows)
                </label>
                <textarea
                  ref={(el) => {
                    growthAreasRef.current = el;
                    if (el) {
                      el.style.height = "auto";
                      el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
                    }
                  }}
                  value={growthAreas}
                  onChange={(e) => {
                    setGrowthAreas(e.target.value);
                  }}
                  placeholder="Where should this teacher focus next?"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm resize-none overflow-hidden focus:outline-none focus:ring-2 focus:ring-orange-200 bg-white text-slate-800"
                  style={{ minHeight: 80 }}
                />
              </div>
            </div>

            {/* ── Action Steps section ──────────────────────────────── */}
            <div
              data-testid="action-step-section"
              className="rounded-xl p-4 shadow-sm flex flex-col gap-3"
              style={{ backgroundColor: "#EFF6FF", border: "1px solid #93C5FD", borderLeft: "4px solid #1034B4" }}
            >
              {/* Loading spinner */}
              {loadingLastActionStep && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 size={12} className="animate-spin" /> Loading previous action step…
                </div>
              )}

              {/* Last action step banner */}
              {!loadingLastActionStep && lastActionStep && (() => {
                const displayMastered = lastActionStep.status === "mastered" || (lastActionStep.status === "open" && markMastered);
                return (
                <div
                  className="rounded-lg px-3 py-3 space-y-2"
                  style={{
                    backgroundColor: displayMastered ? "#F0FDF4" : "#FFF7ED",
                    border: `1.5px solid ${displayMastered ? "#86EFAC" : "#FED7AA"}`,
                  }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: displayMastered ? "#15803D" : "#C2410C" }}
                    >
                      {displayMastered
                        ? "✓ Previous Action Step (Mastered)"
                        : "↻ Previous Action Step (Open)"}
                    </span>
                    {lastActionStep.dueDate < todayIso! && !displayMastered && (
                      <span
                        className="text-xs font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: "#FEE2E2", color: "#B91C1C" }}
                      >
                        Overdue
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-800 leading-snug">{lastActionStep.text}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>
                      Assigned:{" "}
                      <span className="font-semibold text-slate-700">
                        {new Date(lastActionStep.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </span>
                    <span>
                      Due:{" "}
                      <span className="font-semibold text-slate-700">
                        {(() => {
                          const [y, m, d] = lastActionStep.dueDate.split("-").map(Number);
                          return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                        })()}
                      </span>
                    </span>
                    {lastActionStep.assignedByName && (
                      <span>
                        Assigned By:{" "}
                        <span className="font-semibold text-slate-700">{lastActionStep.assignedByName}</span>
                      </span>
                    )}
                    {lastActionStep.status === "mastered" && lastActionStep.masteredAt && (
                      <span>
                        Mastered:{" "}
                        <span className="font-semibold text-green-700">
                          {new Date(lastActionStep.masteredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Action buttons row */}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {lastActionStep.status === "open" && (
                      <button
                        type="button"
                        onClick={() => setMarkMastered(!markMastered)}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border transition-colors"
                        style={markMastered
                          ? { backgroundColor: "#16a34a", borderColor: "#16a34a", color: "#fff" }
                          : { borderColor: "#16a34a", color: "#15803d", backgroundColor: "transparent" }
                        }
                      >
                        <CheckCircle size={13} />
                        {markMastered ? "Marked as Mastered" : "Mark as Mastered"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleRepeatLast}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border transition-colors hover:bg-slate-50"
                      style={{ borderColor: "#CBD5E1", color: "#475569" }}
                    >
                      <RefreshCw size={11} /> Repeat last action step
                    </button>
                  </div>
                </div>
                );
              })()}

              {/* New action step fields — flat inside the outer blue card */}
              <p className="text-xs font-bold uppercase tracking-wider mb-0.5" style={{ color: "#1034B4" }}>
                → Assign New Action Step <span className="font-normal text-slate-500 normal-case">(optional)</span>
              </p>
              <div className="flex flex-col gap-3">
                <div className="min-w-0 overflow-hidden">
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                    Action Step
                  </label>
                  <textarea
                    ref={(el) => {
                      actionStepTextRef.current = el;
                      if (el) {
                        el.style.height = "auto";
                        el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
                      }
                    }}
                    value={actionStepText}
                    onChange={(e) => {
                      setActionStepText(e.target.value);
                    }}
                    placeholder="Describe the action step for this teacher…"
                    className="w-full min-w-0 px-3 py-2.5 rounded-lg border border-slate-200 text-sm resize-none overflow-hidden focus:outline-none focus:ring-2 bg-white text-slate-800"
                    style={{ boxSizing: "border-box", borderColor: actionStepPartiallyFilled && !hasActionStepText ? "#f87171" : undefined, minHeight: 80 }}
                  />
                  {actionStepPartiallyFilled && !hasActionStepText && (
                    <p className="text-xs font-semibold text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} className="shrink-0" /> Description is required when a due date is set.
                    </p>
                  )}
                </div>
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                    Due Date <span className="font-normal">(required if action step is entered)</span>
                  </label>
                  <div
                    className="w-full overflow-hidden rounded-lg bg-white focus-within:ring-2 focus-within:ring-blue-500"
                    style={{ border: `1px solid ${(actionStepPartiallyFilled && !hasActionStepDate) || actionStepDueDateError ? "#f87171" : "#e2e8f0"}` }}
                  >
                    <input
                      type="date"
                      value={actionStepDueDate}
                      min={todayIso}
                      onChange={(e) => handleActionStepDueDateChange(e.target.value)}
                      className="w-full min-w-0 px-3 py-2.5 text-sm focus:outline-none bg-white text-slate-800"
                      style={{ boxSizing: "border-box", border: "none", display: "block" }}
                    />
                  </div>
                  {actionStepPartiallyFilled && !hasActionStepDate && (
                    <p className="text-xs font-semibold text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} className="shrink-0" /> Due date is required when an action step is entered.
                    </p>
                  )}
                  {actionStepDueDateError && (
                    <p className="text-xs font-semibold text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} className="shrink-0" /> {actionStepDueDateError}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {submitError && (
              <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold">
                {submitError}
              </div>
            )}
          </form>
        )}
      </div>

      {/* Sticky submit footer */}
      {!isLoading && !isError && teachers && rubricData && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 py-3 z-40">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                {autoSaveStatus === "saving" && (
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" /> Saving…
                  </span>
                )}
                {autoSaveStatus === "saved" && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle size={10} />
                    {lastSavedTime ? `Saved ${lastSavedTime}` : "Draft saved"}
                  </span>
                )}
                {autoSaveStatus === "error" && (
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <CloudOff size={10} /> Backed up locally
                  </span>
                )}
                {autoSaveStatus === "idle" && (
                  <a
                    href={`${basePath}/drafts`}
                    className="text-xs font-semibold flex items-center gap-1"
                    style={{ color: NAVY }}
                  >
                    <FileEdit size={11} /> Drafts
                  </a>
                )}
              </div>
            </div>
            {/* Walkthrough toggle — inline in action row */}
            <button
              type="button"
              role="switch"
              aria-checked={isWalkthrough}
              onClick={() => setIsWalkthrough((v) => !v)}
              className="flex items-center gap-1.5 shrink-0 px-2 py-1.5 rounded-lg border transition-colors"
              style={{
                borderColor:     isWalkthrough ? NAVY : "#cbd5e1",
                backgroundColor: isWalkthrough ? "#EEF1FB" : "transparent",
              }}
            >
              <span
                className="font-semibold text-xs"
                style={{ color: isWalkthrough ? NAVY : "#64748b" }}
              >
                Walkthrough
              </span>
              <span
                className="relative inline-flex w-9 h-5 rounded-full transition-colors shrink-0"
                style={{ backgroundColor: isWalkthrough ? NAVY : "#cbd5e1" }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200"
                  style={{ transform: isWalkthrough ? "translateX(16px)" : "translateX(0)" }}
                />
              </span>
            </button>

            <button
              type="submit"
              form="obs-form"
              disabled={saving || !teacherId}
              className="px-6 py-2.5 rounded-lg text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50 shrink-0"
              style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.04em" }}
            >
              {saving ? <Loader2 size={16} className="animate-spin inline" /> : "Submit"}
            </button>
          </div>
        </div>
      )}

      {/* Switch-teacher confirmation dialog */}
      {switchConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget && !savingBeforeSwitch) cancelSwitch(); }}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-white shadow-xl px-6 pt-6 pb-8 flex flex-col gap-4"
            style={{ fontFamily: "'Libre Franklin', sans-serif" }}
          >
            <div className="flex flex-col gap-1">
              <p className="text-base font-bold text-slate-800">Switch teacher?</p>
              <p className="text-sm text-slate-600 leading-snug">
                Your current progress will be saved as a draft first so you can find it in{" "}
                <strong>My Drafts</strong> later.
              </p>
            </div>
            {switchSaveError && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-500" />
                <p className="text-xs text-red-700 leading-snug">{switchSaveError}</p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={savingBeforeSwitch}
                onClick={confirmSwitch}
                className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-70"
                style={{ backgroundColor: NAVY }}
              >
                {savingBeforeSwitch ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Saving draft…
                  </>
                ) : (
                  "Save draft & switch teacher"
                )}
              </button>
              <button
                type="button"
                disabled={savingBeforeSwitch}
                onClick={cancelSwitch}
                className="w-full py-3 rounded-xl text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                Stay on current teacher
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
