import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Plus, Loader2, RotateCcw, AlertCircle, RefreshCw } from "lucide-react";
import { RichTextEditor } from "@/components/RichTextEditor";
import { type Score, type Teacher } from "@/data/dummy";
import type { CategoryEntry, DomainEntry, ActionStep } from "@/lib/api";
import { fetchMyDrafts, deleteObservation, fetchLatestActionStep } from "@/lib/api";
import { saveObservation } from "@/lib/observation-save";
import { toast } from "@/hooks/use-toast";
import { EmailFeedbackPanel } from "@/components/EmailFeedbackPanel";
import { defaultIntro, type EmailSource } from "@/lib/observation-email";
import { teacherMatchesAudience } from "@/lib/subject-audience";
import type { SubjectAudience } from "@/lib/subject-audience";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

interface Props {
  teachers: Teacher[];
  categories: CategoryEntry[];
  allDomains: DomainEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canMarkWalkthrough?: boolean;
  defaultTeacherId?: string;
  defaultIsWalkthrough?: boolean;
  observerName?: string;
  rubricSetId?: number;
  /** Called after a draft is discarded, so a page showing a list can drop it. */
  onDraftDiscarded?: (draftId: string) => void;
  rubricSetAudience?: SubjectAudience;
  freshStart?: boolean;
  resumeDraftId?: string;
  onSubmit: (
    teacherId: string,
    date: string,
    scores: Record<string, Score>,
    strengths: string,
    growthAreas: string,
    isWalkthrough: boolean,
    time: string,
    course: string,
    draftId?: string,
    newActionStep?: { text: string; dueDate: string },
    masterActionStepId?: number,
    /* Mutually exclusive with newActionStep — see the extend flow below. */
    extendActionStep?: { actionStepId: number; newDueDate: string; note?: string },
  ) => Promise<string>;
  saving?: boolean;
}

const SCORE_OPTIONS: { value: Score; label: string }[] = [
  { value: 0,   label: "Not Yet" },
  { value: 0.5, label: "Developing" },
  { value: 1,   label: "Proficient" },
];

function scorePillClass(s: Score, selected: boolean): string {
  if (!selected) return "bg-slate-100 text-slate-400 hover:bg-slate-200 border border-slate-200";
  if (s >= 1)   return "bg-green-600 text-white border-2 border-green-500 shadow-sm";
  if (s >= 0.5) return "bg-yellow-300 text-yellow-900 border-2 border-yellow-400 shadow-sm";
  return "bg-red-300 text-red-900 border-2 border-red-400 shadow-sm";
}

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function NewObservationModal({ teachers: allTeachers, categories, allDomains, open, onOpenChange, canMarkWalkthrough, defaultTeacherId, defaultIsWalkthrough, observerName, rubricSetId, rubricSetAudience, onSubmit, saving, freshStart, resumeDraftId, onDraftDiscarded }: Props) {
  const todayIso = new Date().toISOString().split("T")[0];

  const nowTime = () => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
  };

  const teachers = allTeachers;
  const filteredTeachers = useMemo(
    () => allTeachers
      .filter((t) => teacherMatchesAudience(t.subject, rubricSetAudience ?? "ALL"))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allTeachers, rubricSetAudience],
  );

  /* No fallback to the first teacher in the list. Opening the form without a
     teacher in mind used to select whoever sorted first alphabetically, and
     the observation filed against them — the form looked complete because it
     was, just about somebody else. Blank until a person is chosen. */
  const [teacherId, setTeacherId] = useState(defaultTeacherId ?? "");
  const [date, setDate] = useState(todayIso);
  const [time, setTime] = useState(nowTime);
  const [course, setCourse] = useState("");
  const [scores, setScores] = useState<Partial<Record<string, Score>>>({});
  const [strengths, setStrengths] = useState("");
  const [growthAreas, setGrowthAreas] = useState("");
  const [isWalkthrough, setIsWalkthrough] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState(false);

  /* ── Draft / auto-save state ──────────────────────────────────── */
  const [draftId, setDraftId]                   = useState<string | null>(null);
  const [draftResumedFrom, setDraftResumedFrom] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus]     = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedTime, setLastSavedTime]       = useState<string | null>(null);

  const autoSaveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftJustLoaded   = useRef(false);
  const isSubmittingRef   = useRef(false);
  const draftIdRef        = useRef<string | null>(null);
  /* Just a flag now: the panel builds the email itself from the same source
     the form would have used, so there is nothing to hand it but that. */
  const [emailPreview, setEmailPreview] = useState(false);
  const [editableIntro, setEditableIntro] = useState("");
  const [editableGlows, setEditableGlows] = useState("");
  const [editableGrows, setEditableGrows] = useState("");
  const [, setSavedObsId] = useState<string | null>(null);

  /* ── Action step state ────────────────────────────────────────── */
  const [latestActionStep, setLatestActionStep] = useState<ActionStep | null>(null);
  const [actionStepLoading, setActionStepLoading] = useState(false);
  const [markMastered, setMarkMastered] = useState(false);
  const [newActionStepText, setNewActionStepText] = useState("");
  const [newActionStepDueDate, setNewActionStepDueDate] = useState("");

  /*
   * Extending the existing step, rather than assigning a new one.
   *
   * These are two different answers to "what next for this teacher", so the
   * form shows one or the other, never both. Non-null means we are extending:
   * the new action step box is hidden and its contents cleared.
   */
  const [extendingStepId, setExtendingStepId] = useState<number | null>(null);
  const [extendDueDate, setExtendDueDate]     = useState("");
  const [extendNote, setExtendNote]           = useState("");
  const [actionStepDueDateError, setActionStepDueDateError] = useState<string | null>(null);
  const [teacherError, setTeacherError] = useState<string | null>(null);

  /* Keep draftIdRef in sync so setTimeout callbacks always see latest value */
  useEffect(() => { draftIdRef.current = draftId; }, [draftId]);

  /* Fetch latest action step for a teacher ──────────────────────── */
  const fetchActionStep = useCallback(async (tid: string) => {
    if (!tid) return;
    const teacher = allTeachers.find((t) => t.id === tid);
    const empId = teacher?.employeeId;
    if (!empId) return;
    setActionStepLoading(true);
    try {
      const step = await fetchLatestActionStep(empId);
      setLatestActionStep(step);
    } catch {
      setLatestActionStep(null);
    } finally {
      setActionStepLoading(false);
    }
  }, [allTeachers]);

  /* Silently detect and auto-load a draft for the selected teacher ─── */
  const checkForDraft = useCallback(async (forTeacherId: string) => {
    if (!forTeacherId || !rubricSetId) return;
    try {
      const allDrafts = await fetchMyDrafts();
      const match = allDrafts.find((d) => d.observedEmployeeId === forTeacherId && d.rubricSetId === rubricSetId);
      if (match) {
        draftJustLoaded.current = true;
        setDate(match.date);
        setTime(match.time ?? nowTime());
        setCourse(match.course ?? "");
        setScores(match.scores as Partial<Record<string, Score>>);
        setStrengths(match.strengths ?? "");
        setGrowthAreas(match.growthAreas ?? "");
        /* Restored for the first time. A draft's action step was never put
           back into the form, so resuming showed an empty box while a step
           existed behind it — the same shape of problem as the glows and
           grows. */
        setNewActionStepText(match.actionStepText ?? "");
        setNewActionStepDueDate(match.actionStepDueDate ?? "");
        setIsWalkthrough(match.isWalkthrough);
        setDraftId(match.id);
        setDraftResumedFrom(match.date);
        setAutoSaveStatus("saved");
        setLastSavedTime(null);
      }
    } catch {
      /* silently ignore — draft detection is best-effort */
    }
  }, [rubricSetId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Load a specific draft by ID (used when resuming from Drafts page) ─ */
  const loadDraftById = useCallback(async (id: string) => {
    try {
      const allDrafts = await fetchMyDrafts();
      const match = allDrafts.find((d) => d.id === id);
      if (match) {
        draftJustLoaded.current = true;
        setDate(match.date);
        setTime(match.time ?? nowTime());
        setCourse(match.course ?? "");
        setScores(match.scores as Partial<Record<string, Score>>);
        setStrengths(match.strengths ?? "");
        setGrowthAreas(match.growthAreas ?? "");
        /* Restored for the first time. A draft's action step was never put
           back into the form, so resuming showed an empty box while a step
           existed behind it — the same shape of problem as the glows and
           grows. */
        setNewActionStepText(match.actionStepText ?? "");
        setNewActionStepDueDate(match.actionStepDueDate ?? "");
        setIsWalkthrough(match.isWalkthrough);
        setDraftId(match.id);
        setDraftResumedFrom(match.date);
        setAutoSaveStatus("saved");
        setLastSavedTime(null);
      }
    } catch { /* silently ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* On modal open: reset state, then optionally load a draft ───────── */
  useEffect(() => {
    if (open) {
      const tid = defaultTeacherId ?? "";
      isSubmittingRef.current = false;
      setTeacherId(tid);
      setDate(todayIso);
      setTime(nowTime());
      setCourse("");
      setScores({});
      setStrengths("");
      setGrowthAreas("");
      setIsWalkthrough(!!defaultIsWalkthrough);
      setEmailFeedback(false);
      setDraftId(null);
      setDraftResumedFrom(null);
      setAutoSaveStatus("idle");
      setLastSavedTime(null);
      setLatestActionStep(null);
      setMarkMastered(false);
      setNewActionStepText("");
      setNewActionStepDueDate("");
      setExtendingStepId(null);
      setExtendDueDate("");
      setExtendNote("");
      setActionStepDueDateError(null);
      setTeacherError(null);
      if (resumeDraftId) {
        loadDraftById(resumeDraftId);
      } else if (!freshStart) {
        checkForDraft(tid);
      }
      fetchActionStep(tid);
    }
  }, [open, defaultTeacherId, defaultIsWalkthrough]); // eslint-disable-line react-hooks/exhaustive-deps

  /* When the chosen teacher changes while the modal is open ──────────
     What you have written stays. Scores, glows, grows, the date and a new
     action step describe the lesson you watched, not the person the form is
     pointed at — picking the right name after typing, or correcting a wrong
     one, used to wipe the lot.

     What resets is only what belonged to the other person: their open action
     step, and any decision made about it. */
  useEffect(() => {
    if (!open || !teacherId) return;

    setLatestActionStep(null);
    setMarkMastered(false);
    setExtendingStepId(null);
    setExtendDueDate("");
    setExtendNote("");
    setTeacherError(null);

    /* A draft cannot be moved. The update payload carries no teacher, so
       saving again into the previous person's draft would leave it filed
       against them while the form says otherwise — #48 over again, in draft
       form. Letting go of the id means the next autosave starts a fresh draft
       for the new person; the earlier one stays on the Drafts page. */
    setDraftId(null);
    setDraftResumedFrom(null);
    setAutoSaveStatus("idle");
    setLastSavedTime(null);

    /* Only look for their draft when there is nothing to lose. Loading it over
       the top of what someone has just typed is the same silent loss again. */
    if (!freshStart && !resumeDraftId && !hasUnsavedContent()) checkForDraft(teacherId);
    fetchActionStep(teacherId);
  }, [teacherId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Strip HTML tags before length-checking text fields.
     Tiptap emits "<p></p>" for an empty editor, which has .trim().length > 0
     and would erroneously trigger a draft creation on every modal open. */
  const textContent = (html: string) =>
    html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

  /* Has anything been written that would be lost? */
  function hasUnsavedContent(): boolean {
    return (
      Object.keys(scores).length > 0 ||
      textContent(strengths).length > 0 ||
      textContent(growthAreas).length > 0 ||
      newActionStepText.trim().length > 0
    );
  }

  /* Auto-save: debounced upsert 2 s after any form change ─────────── */
  useEffect(() => {
    if (!open || !teacherId || !rubricSetId || isSubmittingRef.current) return;

    const hasContent =
      Object.keys(scores).length > 0 ||
      textContent(strengths).length > 0 ||
      textContent(growthAreas).length > 0 ||
      (newActionStepText.trim().length > 0 && newActionStepDueDate.length > 0) ||
      markMastered;
    if (!hasContent) return;

    if (draftJustLoaded.current) {
      draftJustLoaded.current = false;
      return;
    }

    setAutoSaveStatus("saving");

    const STALE_DATE_MSG = "Due date must be today or in the future. Please update it.";
    const staleDueDate = newActionStepDueDate.length > 0 && newActionStepDueDate < todayIso;

    let newActionStepDraft =
      newActionStepText.trim().length > 0 && newActionStepDueDate.length > 0
        ? { text: newActionStepText.trim(), dueDate: newActionStepDueDate }
        : undefined;

    if (staleDueDate) {
      setActionStepDueDateError(STALE_DATE_MSG);
      newActionStepDraft = undefined;
    } else if (actionStepDueDateError === STALE_DATE_MSG) {
      setActionStepDueDateError(null);
    }

    const masterActionStepIdDraft =
      markMastered && latestActionStep?.status === "open" ? latestActionStep.id : undefined;

    const timer = setTimeout(async () => {
      if (isSubmittingRef.current) return;
      try {
        const currentDraftId = draftIdRef.current;
        /* One description of the observation, whether it is being created or
           saved again. See ObservationFormFields — leaving a field out here is
           a compile error rather than a field that quietly stops being sent. */
        const obs = await saveObservation({
          draftId:  currentDraftId ?? undefined,
          status:   "draft",
          observer: observerName,
          fields: {
            teacherId, rubricSetId, date, time, course,
            scores:             scores as Record<string, Score>,
            strengths, growthAreas, isWalkthrough,
            newActionStep:      newActionStepDraft,
            masterActionStepId: masterActionStepIdDraft,
          },
        });
        const savedId = obs.id;
        if (!currentDraftId) setDraftId(savedId);
        const now = new Date();
        const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        setAutoSaveStatus("saved");
        setLastSavedTime(t);
      } catch {
        setAutoSaveStatus("error");
      }
    }, 2000);

    autoSaveTimerRef.current = timer;
    return () => { clearTimeout(timer); autoSaveTimerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, teacherId, date, time, course, JSON.stringify(scores), strengths, growthAreas, isWalkthrough, newActionStepText, newActionStepDueDate, markMastered]);

  /* What the email is built from. The action steps are what THIS observation
     is doing about them — assigning one, marking one mastered, or leaving an
     earlier one standing — which is what the email should say. */
  function emailSource(): EmailSource {
    const t = teachers.find((x) => x.id === teacherId);
    return {
      teacher: t && {
        name: t.name, firstName: t.firstName, email: t.email,
        subject: t.subject, gradeLevel: t.gradeLevel,
      },
      date, time, course,
      observerName,
      categories,
      scores,
      strengths,
      growthAreas,
      steps: {
        mastered: (markMastered && latestActionStep?.status === "open")
          ? { text: latestActionStep.text, masteredByName: observerName }
          : undefined,
        stillOpen: (latestActionStep?.status === "open" && !markMastered)
          ? { text: latestActionStep.text, dueDate: latestActionStep.dueDate, assignedByName: latestActionStep.assignedByName }
          : undefined,
        assigned: (newActionStepText.trim() && newActionStepDueDate)
          ? { text: newActionStepText.trim(), dueDate: newActionStepDueDate }
          : undefined,
      },
      priorObservations: t?.observations ?? [],
    };
  }

  const scoredCount = allDomains.filter((d) => scores[d.id] !== undefined).length;

  function reset() {
    setTeacherId(defaultTeacherId ?? "");
    setDate(todayIso);
    setTime(nowTime());
    setCourse("");
    setScores({});
    setStrengths("");
    setGrowthAreas("");
    setIsWalkthrough(false);
    setEmailFeedback(false);
    setEmailPreview(false);
    setEditableIntro("");
    setEditableGlows("");
    setEditableGrows("");
    setDraftId(null);
    setDraftResumedFrom(null);
    setAutoSaveStatus("idle");
    setLastSavedTime(null);
    setLatestActionStep(null);
    setMarkMastered(false);
    setNewActionStepText("");
    setNewActionStepDueDate("");
    setExtendingStepId(null);
    setExtendDueDate("");
    setExtendNote("");
    setActionStepDueDateError(null);
    setTeacherError(null);
  }



  async function handleSubmit() {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    isSubmittingRef.current = true;
    if (!teacherId) {
      setTeacherError("Choose a teacher before submitting this observation.");
      isSubmittingRef.current = false;
      return;
    }

    /* ── Action step validation ── */
    const hasNewStep = newActionStepText.trim().length > 0 || newActionStepDueDate.length > 0;
    if (hasNewStep) {
      if (!newActionStepText.trim() || !newActionStepDueDate) {
        setActionStepDueDateError("Both action step text and a due date are required.");
        isSubmittingRef.current = false;
        return;
      }
      if (newActionStepDueDate < todayIso) {
        setActionStepDueDateError("Due date must be today or in the future. Please update it.");
        isSubmittingRef.current = false;
        return;
      }
    }
    setActionStepDueDateError(null);

    /* ── Extension validation ── */
    if (extendingStepId !== null) {
      if (!extendDueDate) {
        setActionStepDueDateError("Pick a new due date for the action step you are extending.");
        isSubmittingRef.current = false;
        return;
      }
      if (extendDueDate < todayIso) {
        setActionStepDueDateError("New due date must be today or in the future.");
        isSubmittingRef.current = false;
        return;
      }
    }

    const newActionStepPayload = hasNewStep && newActionStepText.trim() && newActionStepDueDate
      ? { text: newActionStepText.trim(), dueDate: newActionStepDueDate }
      : undefined;
    /* Never both: the new action step box is hidden while extending, and the
       server rejects a payload carrying both. */
    const extendActionStepPayload = extendingStepId !== null && extendDueDate
      ? { actionStepId: extendingStepId, newDueDate: extendDueDate, note: extendNote.trim() || undefined }
      : undefined;
    const masterActionStepIdPayload = markMastered && latestActionStep?.status === "open"
      ? latestActionStep.id
      : undefined;

    const obsId = await onSubmit(
      teacherId, date, scores as Record<string, Score>, strengths, growthAreas, isWalkthrough, time, course,
      draftId ?? undefined,
      newActionStepPayload,
      masterActionStepIdPayload,
      extendActionStepPayload,
    );
    setSavedObsId(obsId ?? null);
    if (emailFeedback) {
      const _t = teachers.find((t) => t.id === teacherId);
      const firstName = _t?.firstName || _t?.name.split(" ")[0] || "Teacher";
      const observer = observerName ?? "Your Observer";
      const intro = defaultIntro(firstName, observer);
      const glows = strengths;
      const grows = growthAreas;
      setEditableIntro(intro);
      setEditableGlows(glows);
      setEditableGrows(grows);
      setEmailPreview(true);
    } else {
      reset();
      onOpenChange(false);
    }
  }

  /* ── Closing the observation ──────────────────────────────────────
     Autosave runs on a 2-second debounce, so "saving" means the person has
     changed something the server has not acknowledged yet, and "error" means
     a write already failed. Closing in either state can lose what they typed,
     so it asks first.

     Otherwise, when a draft was written, say so on the way out — the
     observation vanishing with no explanation is what makes people retype it,
     and the Drafts page is not somewhere they would think to look unless
     told. */
  function attemptClose() {
    if (autoSaveStatus === "saving" || autoSaveStatus === "error") {
      const message = autoSaveStatus === "error"
        ? "This observation could not be saved.\n\nIf you close now, what you have entered will be lost. Close anyway?"
        : "This observation has not finished saving.\n\nIf you close now, your most recent changes may be lost. Close anyway?";
      if (!window.confirm(message)) return;
    } else if (draftId && autoSaveStatus === "saved") {
      /* This used to link to /drafts. There is no such page now — the list is
         a pop-up on whatever screen you are already on — so the message says
         where the button is instead of offering a link to nowhere. */
      toast({
        title: "Draft saved",
        description: "Find it under My Drafts, in the account menu.",
      });
    }
    reset();
    onOpenChange(false);
  }

  /* Deleting somebody's written feedback is not undoable, so it asks first —
     and then closes, because leaving an empty form open where the draft was
     reads as though nothing happened. */
  async function discardDraft() {
    if (!draftId) return;
    const ok = window.confirm(
      "Discard this draft?\n\nEverything entered here will be deleted. This cannot be undone.",
    );
    if (!ok) return;
    try {
      const discardedId = draftId;
      await deleteObservation(discardedId);

      /* The Drafts page may be the page underneath this modal and caches its
         list, so the draft would be gone from the server and still on screen —
         which reads as the discard having failed. Told through a callback
         rather than reaching for the query cache here: this modal is opened by
         four different pages and only one of them shows a list of drafts. */
      onDraftDiscarded?.(discardedId);

      reset();
      toast({ title: "Draft discarded" });
      onOpenChange(false);
    } catch {
      toast({ title: "Could not discard draft", variant: "destructive" });
    }
  }

  const inputBase =
    "w-full px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) { attemptClose(); return; } onOpenChange(o); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed z-50 flex flex-col bg-white shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 inset-x-2 inset-y-3 rounded-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-2xl sm:max-h-[74vh]">

          {/* ── Modal Header ─────────────────────────────── */}
          <div className="shrink-0 px-6 py-4" style={{ backgroundColor: NAVY }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: YELLOW }}
                >
                  <Plus size={16} color={NAVY} strokeWidth={3} />
                </div>
                <DialogPrimitive.Title
                  className="text-white font-bold uppercase tracking-wider"
                  style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.03em" }}
                >
                  New Observation
                </DialogPrimitive.Title>
              </div>
              <DialogPrimitive.Close className="text-blue-300 hover:text-white transition-colors rounded p-1">
                <X size={20} />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* ── Email Preview Screen ──────────────────────── */}
          {emailPreview && (
            <EmailFeedbackPanel
              src={emailSource()}
              initialIntro={editableIntro}
              initialGlows={editableGlows}
              initialGrows={editableGrows}
              onClose={() => { reset(); onOpenChange(false); }}
            />
          )}

          {/* ── Form (hidden when showing email preview) ───── */}
          {!emailPreview && (<><div className="overflow-y-auto flex-1 px-6 py-5 space-y-5" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>

            {/* ── Resuming auto-saved draft indicator ──────────── */}
            {draftResumedFrom && draftId && (
              <div
                className="flex items-center justify-between px-3 py-2 rounded text-xs font-semibold"
                style={{ backgroundColor: "#f0fdf4", border: "1px solid #86efac", color: "#15803d" }}
              >
                <span className="flex items-center gap-1.5">
                  <RotateCcw size={11} />
                  Auto-saved draft from {formatDateLong(draftResumedFrom)} — submit to publish
                </span>
                <button
                  type="button"
                  onClick={discardDraft}
                  className="ml-4 text-xs text-red-600 hover:underline shrink-0"
                >
                  Discard
                </button>
              </div>
            )}

            {/* No-teachers notice */}
            {filteredTeachers.length === 0 && (rubricSetAudience ?? "ALL") !== "ALL" && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200">
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-500" />
                <p className="text-sm text-amber-800 leading-snug">
                  No teachers match this rubric's audience. Switch to an All-audience rubric or update teacher subjects.
                </p>
              </div>
            )}

            {/* Teacher + Date + Time */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="sm:col-span-1">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Teacher
                </label>
                <select
                  value={teacherId}
                  onChange={(e) => { setTeacherId(e.target.value); setTeacherError(null); }}
                  disabled={filteredTeachers.length === 0}
                  className={`${inputBase} disabled:opacity-50 disabled:cursor-not-allowed ${
                    teacherError ? "border-red-400 ring-2 ring-red-200" : ""
                  } ${teacherId ? "" : "text-slate-500"}`}
                >
                  {filteredTeachers.length === 0 ? (
                    <option value="" disabled>No teachers available</option>
                  ) : (
                    <option value="">Select a teacher…</option>
                  )}
                  {filteredTeachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.subject}, Grade{t.gradeLevel.length !== 1 ? "s" : ""} {t.gradeLevel.join(", ")})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Observation Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Time
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={inputBase}
                />
              </div>
            </div>

            {/* Subject / Course */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Subject / Course Being Observed
              </label>
              <input
                type="text"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                placeholder="e.g. AP Biology, 8th Grade Math, ELA Block 2…"
                className={inputBase}
              />
            </div>


            {/* Progress indicator */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: allDomains.length ? `${(scoredCount / allDomains.length) * 100}%` : "0%",
                    backgroundColor: scoredCount === allDomains.length ? "#16a34a" : NAVY,
                  }}
                />
              </div>
              <span className="text-xs font-semibold shrink-0" style={{ color: scoredCount === allDomains.length ? "#16a34a" : "#64748b" }}>
                {scoredCount} / {allDomains.length} scored
              </span>
            </div>

            {/* Score legend */}
            <div className="flex items-center gap-3 flex-wrap text-xs font-semibold">
              <span className="text-slate-400 uppercase tracking-wide mr-1">Scale:</span>
              {SCORE_OPTIONS.map(({ value, label }) => (
                <span key={value} className={`px-2.5 py-0.5 rounded ${scorePillClass(value, true)}`}>
                  {value === 0 ? "0" : value === 1 ? "1" : "0.5"} · {label}
                </span>
              ))}
            </div>

            {/* Domain scores per category */}
            {categories.map((cat) => (
              <div key={cat.id}>
                <div
                  className="px-3 py-2 rounded-t font-bold uppercase tracking-wider text-white"
                  style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em" }}
                >
                  {cat.label}
                </div>
                <div className="border border-t-0 border-slate-200 rounded-b divide-y divide-slate-100">
                  {cat.domains.map((domain) => {
                    return (
                      <div
                        key={domain.id}
                        className="flex items-start justify-between px-3 py-2.5 transition-colors gap-4"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-700">{domain.label}</p>
                          {domain.description && (
                            <p className="text-xs text-slate-400 mt-0.5 leading-snug">{domain.description}</p>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {SCORE_OPTIONS.map(({ value, label }) => (
                            <button
                              key={value}
                              type="button"
                              title={label}
                              onClick={() => setScores((prev) => ({ ...prev, [domain.id]: prev[domain.id] === value ? undefined : value }))}
                              className={`px-3 h-9 rounded font-bold text-sm transition-all whitespace-nowrap ${scorePillClass(value, scores[domain.id] === value)}`}
                            >
                              {value === 0 ? "0" : value === 1 ? "1" : "0.5"}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* ── Latest Action Step Banner ────────────────── */}
            {actionStepLoading && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-500" style={{ backgroundColor: "#F4F6FB", border: "1px solid #dde3f0" }}>
                <Loader2 size={12} className="animate-spin" /> Loading previous action step…
              </div>
            )}
            {!actionStepLoading && latestActionStep && (
              <div
                className="rounded-lg px-4 py-3 space-y-2"
                style={{
                  backgroundColor: latestActionStep.status === "mastered" ? "#F0FDF4" : "#FFF7ED",
                  border: `1.5px solid ${latestActionStep.status === "mastered" ? "#86EFAC" : "#FED7AA"}`,
                }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-xs font-bold uppercase tracking-wider"
                    style={{ color: latestActionStep.status === "mastered" ? "#15803D" : "#C2410C" }}
                  >
                    {latestActionStep.status === "mastered" ? "✓ Previous Action Step (Mastered)" : "↻ Previous Action Step (Open)"}
                  </span>
                  {latestActionStep.dueDate < todayIso && latestActionStep.status === "open" && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "#FEE2E2", color: "#B91C1C" }}>Overdue</span>
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-800 leading-snug">{latestActionStep.text}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Assigned: <span className="font-semibold text-slate-700">{new Date(latestActionStep.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></span>
                  <span>Due: <span className="font-semibold text-slate-700">{(() => { const [y, m, d] = latestActionStep.dueDate.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); })()}</span></span>
                  {latestActionStep.assignedByName && <span>Assigned By: <span className="font-semibold text-slate-700">{latestActionStep.assignedByName}</span></span>}
                  {latestActionStep.status === "mastered" && latestActionStep.masteredAt && (
                    <span>Mastered: <span className="font-semibold text-green-700">{new Date(latestActionStep.masteredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></span>
                  )}
                </div>
                {/* Two-button row — only for open steps, and only while not
                    extending. Extending means "not done yet", so offering
                    "Mark as Mastered" beside it asks the observer to say two
                    contradictory things about the same step. */}
                {latestActionStep.status === "open" && extendingStepId === null && (
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setMarkMastered((prev) => !prev)}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border transition-colors"
                      style={markMastered
                        ? { backgroundColor: "#16a34a", borderColor: "#16a34a", color: "white" }
                        : { backgroundColor: "white", borderColor: "#16a34a", color: "#16a34a" }
                      }
                    >
                      {markMastered ? <>✓ Mastered</> : <>Mark Action Step as Mastered</>}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        /*
                         * This used to copy the text and due date into the new
                         * action step box, so saving created a SECOND open step
                         * saying the same thing. It now extends the existing
                         * one, which is what "repeat" always meant.
                         *
                         * The date starts empty rather than prefilled with the
                         * old one: the reason to extend is that the old date
                         * has passed, so prefilling it produced an immediate
                         * validation error every time.
                         */
                        setExtendingStepId(latestActionStep.id);
                        setMarkMastered(false);
                        setExtendDueDate("");
                        setExtendNote("");
                        setNewActionStepText("");
                        setNewActionStepDueDate("");
                        setActionStepDueDateError(null);
                      }}
                      disabled={markMastered}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border transition-colors disabled:opacity-40"
                      style={{ backgroundColor: "white", borderColor: "#dc2626", color: "#dc2626" }}
                    >
                      <RefreshCw size={11} /> Extend this action step
                    </button>
                  </div>
                )}

                {/* Extending: the fields live inside this box, because they are
                    about THIS step. A separate panel below read as a second,
                    unrelated thing being assigned. */}
                {extendingStepId !== null && (
                  <div className="mt-2 pt-3 space-y-3" style={{ borderTop: "1.5px dashed #FED7AA" }}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "#C2410C" }}>
                        Extending &mdash; same step, new deadline
                      </span>
                      <button
                        type="button"
                        onClick={() => { setExtendingStepId(null); setExtendDueDate(""); setExtendNote(""); setActionStepDueDateError(null); }}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-700 underline shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="flex gap-3 items-start flex-wrap">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">New Due Date</label>
                        <input
                          type="date"
                          aria-label="New Due Date"
                          value={extendDueDate}
                          min={todayIso}
                          onChange={(e) => { setExtendDueDate(e.target.value); setActionStepDueDateError(null); }}
                          className="border rounded px-2 py-1.5 text-sm bg-white"
                          style={{ borderColor: "#FED7AA" }}
                        />
                      </div>
                      <div className="flex-1 min-w-[12rem]">
                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                          Note <span className="font-normal text-slate-400">(optional)</span>
                        </label>
                        <input
                          type="text"
                          aria-label="Extension note"
                          value={extendNote}
                          maxLength={500}
                          placeholder="e.g. teacher was out two weeks"
                          onChange={(e) => setExtendNote(e.target.value)}
                          className="w-full border rounded px-2 py-1.5 text-sm bg-white"
                          style={{ borderColor: "#FED7AA" }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── New Action Step ──────────────────────────── */}
            {/* Hidden while extending: an observation either extends the
                existing step or assigns a new one, never both. */}
            {extendingStepId === null && (
            <div
              className="rounded-lg px-4 py-3 space-y-3 bg-blue-50"
              style={{ border: "1px solid #93C5FD", borderLeft: "4px solid #3B82F6" }}
            >
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: NAVY }}>
                → Assign New Action Step <span className="font-normal text-slate-400 normal-case">(optional)</span>
              </p>
              <div className="flex gap-3 items-start">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Action Step</label>
                  {/* aria-label because the label above is not associated with
                      this control — screen readers had nothing to announce. */}
                  <textarea
                    aria-label="Action Step"
                    ref={(el) => {
                      if (el && el.value) {
                        el.style.height = "auto";
                        el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
                      }
                    }}
                    rows={1}
                    value={newActionStepText}
                    onChange={(e) => {
                      const el = e.target;
                      el.style.height = "auto";
                      el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
                      setNewActionStepText(e.target.value);
                      setActionStepDueDateError(null);
                    }}
                    placeholder="Describe the specific action step for this teacher…"
                    className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white resize-none overflow-y-auto"
                    style={{ fontFamily: "'Libre Franklin', sans-serif" }}
                  />
                </div>
                <div className="shrink-0" style={{ width: 148 }}>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newActionStepDueDate}
                    min={todayIso}
                    onChange={(e) => { setNewActionStepDueDate(e.target.value); setActionStepDueDateError(null); }}
                    className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
                    style={{ fontFamily: "'Libre Franklin', sans-serif" }}
                  />
                </div>
              </div>
              {actionStepDueDateError && (
                <div className="flex items-center gap-2 text-xs font-semibold text-red-700">
                  <AlertCircle size={12} className="shrink-0" />
                  {actionStepDueDateError}
                </div>
              )}
            </div>
            )}

            {/* Notes */}
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: "#16a34a" }}>
                  ✦ Teacher Strengths (Glows)
                </label>
                <RichTextEditor
                  value={strengths}
                  onChange={setStrengths}
                  placeholder="What is this teacher doing well?"
                  focusBorderColor="#86efac"
                  minHeight={90}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: "#ea580c" }}>
                  ↑ Growth Areas (Grows)
                </label>
                <RichTextEditor
                  value={growthAreas}
                  onChange={setGrowthAreas}
                  placeholder="Where should this teacher focus next?"
                  focusBorderColor="#fdba74"
                  minHeight={90}
                />
              </div>
            </div>

            {/* Email Teacher Feedback toggle */}
            <div
              className="flex items-center justify-between px-4 py-3 rounded-lg"
              style={{ backgroundColor: emailFeedback ? "#f0fdf4" : "#f8fafc", border: `1.5px solid ${emailFeedback ? "#16a34a" : "#dde3f0"}` }}
            >
              <div>
                <p className="font-bold text-sm" style={{ color: emailFeedback ? "#15803d" : "#374151" }}>✉ Email Teacher Feedback</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  After submitting, open a draft email with rubric scores, glows, and grows pre-filled.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={emailFeedback}
                onClick={() => setEmailFeedback((v) => !v)}
                className="relative shrink-0 ml-4 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-300"
                style={{ backgroundColor: emailFeedback ? "#16a34a" : "#cbd5e1" }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                  style={{ transform: emailFeedback ? "translateX(20px)" : "translateX(0)" }}
                />
              </button>
            </div>
          </div>

          {/* ── Footer ───────────────────────────────────── */}
          <div className="shrink-0 border-t border-slate-200 bg-slate-50">
          {teacherError && (
            <div className="flex items-center justify-end gap-2 px-4 sm:px-6 pt-3 text-xs font-semibold text-red-700">
              <AlertCircle size={13} className="shrink-0" />
              {teacherError}
            </div>
          )}
          <div className="px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-3 order-2 sm:order-1 min-w-0">
              <p className="text-xs text-slate-400 truncate">
                {scoredCount === allDomains.length
                  ? "✓ All domains scored."
                  : `${scoredCount} of ${allDomains.length} domains scored`}
              </p>
              {autoSaveStatus === "saving" && (
                <span className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
                  <Loader2 size={11} className="animate-spin" /> Saving…
                </span>
              )}
              {autoSaveStatus === "saved" && lastSavedTime && (
                <span className="text-xs text-green-600 shrink-0">✓ Saved {lastSavedTime}</span>
              )}
              {autoSaveStatus === "saved" && !lastSavedTime && draftResumedFrom && (
                <span className="text-xs text-blue-600 shrink-0">Draft loaded</span>
              )}
              {autoSaveStatus === "error" && (
                <span className="text-xs text-red-500 shrink-0">⚠ Draft not saved</span>
              )}
              {/* Nothing is being autosaved, because a draft has to belong to
                  somebody. Said here, in the place that otherwise reports the
                  saving, rather than left to be inferred from its silence. */}
              {!teacherId && hasUnsavedContent() && (
                <span className="flex items-center gap-1 text-xs font-semibold text-red-600 shrink-0">
                  <AlertCircle size={11} className="shrink-0" />
                  Not saving — no teacher selected
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-3 order-1 sm:order-2 shrink-0 flex-wrap justify-end">
              {/* Walkthrough toggle — inline in action row */}
              <button
                type="button"
                role="switch"
                aria-checked={isWalkthrough}
                onClick={() => setIsWalkthrough((v) => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border transition-colors"
                style={{
                  borderColor:     isWalkthrough ? NAVY : "#cbd5e1",
                  backgroundColor: isWalkthrough ? "#EEF1FB" : "white",
                }}
              >
                <span
                  className="text-xs font-semibold"
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

              <DialogPrimitive.Close
                className="px-4 sm:px-5 py-2 rounded text-sm font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-100 transition-colors text-center"
              >
                Close
              </DialogPrimitive.Close>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className="px-5 sm:px-7 py-2 rounded text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-60"
                style={{ backgroundColor: NAVY }}
              >
                {saving ? "Saving…" : "Submit"}
              </button>
            </div>
          </div>
          </div>
          </>)}

        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
