import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { QUERY_KEYS } from "@/lib/queryKeys";
import {
  FileEdit, Trash2, RotateCcw, FileX, Loader2, X,
  CheckSquare, Square, ChevronDown,
} from "lucide-react";
import { useUser } from "@/context/UserContext";
import {
  fetchMyDrafts,
  deleteObservation,
  fetchDashboard,
  type DraftObservation,
  type CategoryEntry,
} from "@/lib/api";
import { saveObservation } from "@/lib/observation-save";
import { NewObservationModal } from "@/components/NewObservationModal";
import { toast } from "@/hooks/use-toast";
import type { Teacher, DomainEntry, Score } from "@/data/dummy";
import { trackEvent } from "@/lib/analytics";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day:   "numeric",
    year:  "numeric",
  });
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function isDraftEmpty(draft: DraftObservation): boolean {
  return (
    Object.keys(draft.scores).length === 0 &&
    stripHtml(draft.strengths  ?? "").length === 0 &&
    stripHtml(draft.growthAreas ?? "").length === 0
  );
}

function daysAgoFromDate(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const obs = new Date(iso + "T00:00:00");
  return Math.round((today.getTime() - obs.getTime()) / (1000 * 60 * 60 * 24));
}

const STALE_OPTIONS = [
  { label: "3+ days old",  days: 3  },
  { label: "7+ days old",  days: 7  },
  { label: "14+ days old", days: 14 },
  { label: "30+ days old", days: 30 },
];

interface Props {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The drafts list, over whatever screen you were already on.
 *
 * It used to be its own page, reached by leaving the one you were working on
 * and coming back afterwards. Nothing about a list of your own unfinished
 * observations needs a page of its own, and the round trip was the whole cost
 * of glancing at it.
 *
 * Lives here rather than in each screen: the account menu carries the button
 * and sits on every screen, so this hangs off the menu and works everywhere at
 * once, with nothing for a new screen to wire up.
 */
export function DraftsModal({ open, onOpenChange }: Props) {
  const { currentUser } = useUser();
  const queryClient     = useQueryClient();

  const [deleting,      setDeleting]      = useState<string | null>(null);
  const [bulkDeleting,  setBulkDeleting]  = useState(false);
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [staleMenuOpen, setStaleMenuOpen] = useState(false);

  /* ── Resume-modal state ─────────────────────────────────────────── */
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeData, setResumeData] = useState<{
    draft:      DraftObservation;
    teachers:   Teacher[];
    categories: CategoryEntry[];
    allDomains: DomainEntry[];
  } | null>(null);
  const [resumeLoading, setResumeLoading] = useState<string | null>(null);
  const [resumeSaving,  setResumeSaving]  = useState(false);

  /* ── Drafts query ───────────────────────────────────────────────── */
  const { data: drafts = [], isLoading, isError } = useQuery<DraftObservation[]>({
    queryKey:  QUERY_KEYS.myDrafts,
    queryFn:   fetchMyDrafts,
    staleTime: 15_000,
    /* Nothing to fetch while the list is shut. */
    enabled:   open,
  });

  /* ── Selection helpers ──────────────────────────────────────────── */
  const emptyDraftIds  = useMemo(() => drafts.filter(isDraftEmpty).map((d) => d.id), [drafts]);
  const emptyCount     = emptyDraftIds.length;
  const allSelected    = drafts.length > 0 && selected.size === drafts.length;
  const someSelected   = selected.size > 0;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll()   { setSelected(new Set(drafts.map((d) => d.id))); }
  function deselectAll() { setSelected(new Set()); }

  function selectEmpty() {
    setSelected(new Set(emptyDraftIds));
    if (emptyDraftIds.length === 0) {
      toast({ title: "No empty drafts to select" });
    }
  }

  function selectOlderThan(days: number) {
    const ids = drafts
      .filter((d) => daysAgoFromDate(d.date) >= days)
      .map((d) => d.id);
    setSelected(new Set(ids));
    setStaleMenuOpen(false);
    if (ids.length === 0) {
      toast({ title: `No drafts older than ${days} days` });
    }
  }

  function selectEmptyAndOlderThan(days: number) {
    const ids = drafts
      .filter((d) => isDraftEmpty(d) && daysAgoFromDate(d.date) >= days)
      .map((d) => d.id);
    setSelected(new Set(ids));
    setStaleMenuOpen(false);
    if (ids.length === 0) {
      toast({ title: `No empty drafts older than ${days} days` });
    }
  }

  /* ── Handlers ───────────────────────────────────────────────────── */
  /* Drop rows from the cached list straight away.
     invalidateQueries alone leaves the row on screen for a whole round trip,
     which reads as the delete having failed — people click again, or reload to
     check. The refetch still follows; this only removes the wait. */
  function removeFromList(ids: string[]) {
    const gone = new Set(ids);
    queryClient.setQueryData<DraftObservation[]>(
      QUERY_KEYS.myDrafts,
      (prev) => prev?.filter((d) => !gone.has(d.id)),
    );
  }

  async function handleDelete(draft: DraftObservation) {
    /* Deleting one draft was the only path here that did not ask. Bulk delete
       has always confirmed, and a single draft is just as unrecoverable — it
       is somebody's written feedback, and the row sits next to Resume. */
    const who = draft.teacherName ? ` for ${draft.teacherName}` : "";
    const ok = window.confirm(
      `Delete this draft${who}?\n\nEverything entered in it will be deleted. This cannot be undone.`,
    );
    if (!ok) return;

    setDeleting(draft.id);
    try {
      await deleteObservation(draft.id);
      setSelected((prev) => { const next = new Set(prev); next.delete(draft.id); return next; });
      removeFromList([draft.id]);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.myDrafts });
      toast({ title: "Draft deleted" });
      trackEvent("draft_discarded", { surface: "dashboard" });
    } catch {
      toast({ title: "Could not delete draft", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const count = ids.length;
    if (!confirm(`Delete ${count} draft${count !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      await Promise.all(ids.map((id) => deleteObservation(id)));
      setSelected(new Set());
      removeFromList(ids);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.myDrafts });
      toast({ title: `Deleted ${count} draft${count !== 1 ? "s" : ""}` });
      trackEvent("draft_discarded", { surface: "dashboard" });
    } catch {
      toast({ title: "Some drafts could not be deleted", variant: "destructive" });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.myDrafts });
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleResume(draft: DraftObservation) {
    setResumeLoading(draft.id);
    try {
      const data = await fetchDashboard(
        draft.rubricSetSlug ?? "Q1",
        currentUser?.schoolId ?? null,
      );
      const allDomains = data.categories.flatMap((c) => c.domains);
      setResumeData({ draft, teachers: data.teachers, categories: data.categories, allDomains });
      /* The list steps aside rather than stacking. One window at a time, and
         it comes back when the observation closes so a run of drafts can be
         worked through without reopening the menu each time. */
      onOpenChange(false);
      setResumeOpen(true);
      trackEvent("draft_resumed", { surface: "dashboard" });
    } catch {
      toast({ title: "Could not load draft data", variant: "destructive" });
    } finally {
      setResumeLoading(null);
    }
  }

  function closeResume() {
    setResumeOpen(false);
    setResumeData(null);
    onOpenChange(true);
  }

  async function handleSubmitResumed(
    teacherId:    string,
    date:         string,
    scores:       Record<string, Score>,
    strengths:    string,
    growthAreas:  string,
    isWalkthrough: boolean,
    time:         string,
    course:       string,
    draftId?:     string,
    newActionStep?: { text: string; dueDate: string },
    masterActionStepId?: number,
    extendActionStep?: { actionStepId: number; newDueDate: string; note?: string },
  ): Promise<string> {
    if (!resumeData) {
      throw new Error("This draft could not be read, so it was not submitted. Close and reopen My Drafts, then try again.");
    }
    setResumeSaving(true);
    try {
      const fields = {
        teacherId, rubricSetId: resumeData.draft.rubricSetId, date, time, course, scores,
        strengths, growthAreas, isWalkthrough,
        newActionStep, masterActionStepId, extendActionStep,
      };
      const obs = await saveObservation({
        draftId, fields, status: "published",
        observer:   currentUser?.name ?? "Unknown",
        observerId: currentUser?.id,
      });
      if (obs.masteryWarning) {
        toast({
          title: "Observation submitted — mastery note",
          description: obs.masteryWarning,
          variant: "destructive",
        });
      }
      /* Publishing from here changes far more than the drafts list, and used to
         refresh only the drafts list. The observation and any action step it
         assigns are read from the dashboard and Action Center caches, so a
         draft published here vanished from Drafts — correctly — and then did
         not appear on the teacher's profile until something else happened to
         refetch. Nothing said so: the toast below reports a successful submit
         either way, which is what made it read as a save that had not worked.
         These are the same three keys the dashboard's own submit invalidates
         (Dashboard.tsx, handleNewObservation); the two must not drift apart. */
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.myDrafts });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.latestActionSteps });
      await queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.actionSteps, teacherId] });
      if (!obs.masteryWarning) toast({ title: "Observation submitted!" });
      return String(obs.id);
    } catch (err) {
      /* Passed on rather than turned into a toast. A toast over a window that
         had already closed and cleared itself was the whole problem: the form
         now stays open with the wording still in it, and says so there. */
      console.error("Failed to submit observation:", err);
      throw err;
    } finally {
      setResumeSaving(false);
    }
  }

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className="fixed z-50 flex flex-col bg-white shadow-2xl overflow-hidden inset-x-2 inset-y-3 rounded-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-4xl sm:max-h-[88vh]"
            style={{ fontFamily: "'Libre Franklin', sans-serif" }}
          >

            {/* ── Header ───────────────────────────────── */}
            <div className="shrink-0 flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 flex items-center justify-center rounded shrink-0"
                  style={{ backgroundColor: NAVY }}
                >
                  <FileEdit size={18} color={YELLOW} />
                </div>
                <div>
                  <DialogPrimitive.Title
                    className="text-2xl uppercase leading-none"
                    style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em" }}
                  >
                    My Drafts
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-xs text-slate-500 mt-0.5">
                    Observations in progress — auto-saved. Submit when you're ready to publish.
                  </DialogPrimitive.Description>
                </div>
              </div>
              <DialogPrimitive.Close
                className="shrink-0 p-1.5 rounded hover:bg-slate-100 transition-colors"
                aria-label="Close drafts"
              >
                <X size={18} className="text-slate-500" />
              </DialogPrimitive.Close>
            </div>

            {/* ── Body ─────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-6 py-5">

              <div className="flex items-start justify-end gap-4 mb-5 flex-wrap">
          {/* Quick-select controls (only shown when there are drafts) */}
          {!isLoading && !isError && drafts.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Select All / Deselect All toggle */}
              <button
                type="button"
                onClick={allSelected ? deselectAll : selectAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border transition-colors"
                style={{
                  borderColor: NAVY,
                  color:       allSelected ? "white" : NAVY,
                  backgroundColor: allSelected ? NAVY : "transparent",
                }}
              >
                {allSelected
                  ? <CheckSquare size={13} />
                  : <Square size={13} />}
                {allSelected ? "Deselect All" : "Select All"}
              </button>

              {/* Select empty button */}
              <button
                type="button"
                onClick={selectEmpty}
                disabled={emptyCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border border-amber-400 text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Select empty{emptyCount > 0 ? ` (${emptyCount})` : ""}
              </button>

              {/* Select stale dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setStaleMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Select older than…
                  <ChevronDown size={12} />
                </button>
                {staleMenuOpen && (
                  <>
                    {/* Backdrop */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setStaleMenuOpen(false)}
                    />
                    <div
                      className="absolute right-0 top-full mt-1 z-20 bg-white rounded-lg border border-slate-200 shadow-lg overflow-hidden min-w-[180px]"
                    >
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-3 pt-2 pb-1">By observation date</p>
                      {STALE_OPTIONS.map(({ label, days }) => (
                        <button
                          key={days}
                          type="button"
                          onClick={() => selectOlderThan(days)}
                          className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          {label}
                        </button>
                      ))}
                      <div className="border-t border-slate-100 mt-1" />
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-3 pt-2 pb-1">Empty &amp; old</p>
                      {STALE_OPTIONS.map(({ label, days }) => (
                        <button
                          key={`empty-${days}`}
                          type="button"
                          onClick={() => selectEmptyAndOlderThan(days)}
                          className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          Empty, {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
              </div>

        {/* ── Bulk-action bar (shown when items are selected) ── */}
        {someSelected && (
          <div
            className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl mb-4 border"
            style={{ backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" }}
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold" style={{ color: NAVY }}>
                {selected.size} draft{selected.size !== 1 ? "s" : ""} selected
              </span>
              <button
                type="button"
                onClick={deselectAll}
                className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2"
              >
                Deselect all
              </button>
            </div>
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "#DC2626" }}
            >
              {bulkDeleting
                ? <><Loader2 size={13} className="animate-spin" />Deleting…</>
                : <><Trash2 size={13} />Delete {selected.size}</>}
            </button>
          </div>
        )}

        {/* ── Loading ── */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div
              className="w-10 h-10 rounded-full border-4 border-blue-200 animate-spin"
              style={{ borderTopColor: NAVY }}
            />
          </div>
        )}

        {/* ── Error ── */}
        {isError && (
          <div className="rounded-xl p-6 text-center text-sm text-red-600 border border-red-200 bg-red-50">
            Could not load drafts. Please refresh the page.
          </div>
        )}

        {/* ── Empty state ── */}
        {!isLoading && !isError && drafts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <FileX size={48} className="text-slate-300" />
            <p className="text-lg font-semibold text-slate-400">No drafts in progress</p>
            <p className="text-sm text-slate-400 max-w-xs">
              Start an observation and it will auto-save here as you go.
            </p>
            {/* "Go to Dashboard" when this was a page. There is nowhere to go
                from a pop-up — the screen behind it is already there. */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="mt-2 px-5 py-2 rounded text-sm font-bold text-white"
              style={{ backgroundColor: NAVY }}
            >
              Close
            </button>
          </div>
        )}

        {/* ── Drafts list ── */}
        {!isLoading && !isError && drafts.length > 0 && (
          <div className="flex flex-col gap-3">
            {drafts.map((draft) => {
              const scoreCount     = Object.keys(draft.scores).length;
              const glows          = draft.strengths  ? stripHtml(draft.strengths)  : null;
              const grows          = draft.growthAreas ? stripHtml(draft.growthAreas) : null;
              const isEmpty        = isDraftEmpty(draft);
              const isBeingDeleted = deleting      === draft.id;
              const isBeingLoaded  = resumeLoading === draft.id;
              const isSelected     = selected.has(draft.id);

              return (
                <div
                  key={draft.id}
                  className="bg-white rounded-xl border shadow-sm px-4 py-4 flex items-start sm:items-center gap-3"
                  style={{
                    borderColor:  isSelected ? "#818CF8" : "#E2E8F0",
                    backgroundColor: isSelected ? "#F5F3FF" : "white",
                    opacity: isBeingDeleted ? 0.5 : 1,
                    transition: "opacity 0.2s, background-color 0.15s, border-color 0.15s",
                  }}
                >
                  {/* ── Checkbox ── */}
                  <button
                    type="button"
                    onClick={() => toggleOne(draft.id)}
                    disabled={isBeingDeleted || isBeingLoaded}
                    className="shrink-0 mt-0.5 sm:mt-0 text-slate-400 hover:text-indigo-600 transition-colors disabled:opacity-30"
                    aria-label={isSelected ? "Deselect draft" : "Select draft"}
                  >
                    {isSelected
                      ? <CheckSquare size={18} style={{ color: "#6366F1" }} />
                      : <Square size={18} />}
                  </button>

                  {/* ── Left: info ── */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="font-bold text-base truncate"
                        style={{ color: NAVY }}
                      >
                        {draft.teacherName ?? `Teacher ${draft.observedEmployeeId}`}
                      </span>
                      {draft.rubricSetName && (
                        <span
                          className="shrink-0 px-2 py-0.5 rounded text-xs font-bold uppercase"
                          style={{ backgroundColor: YELLOW, color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: "0.04em" }}
                        >
                          {draft.rubricSetName}
                        </span>
                      )}
                      {draft.isWalkthrough && (
                        <span className="shrink-0 px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-700">
                          Walkthrough
                        </span>
                      )}
                      {isEmpty && (
                        <span className="shrink-0 px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-200">
                          Empty
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                      <span>{formatDate(draft.date)}</span>
                      {draft.course && <span>· {draft.course}</span>}
                      <span>
                        · {scoreCount > 0 ? `${scoreCount} domain${scoreCount !== 1 ? "s" : ""} scored` : "No domains scored"}
                      </span>
                    </div>

                    {(glows || grows) && (
                      <div className="mt-2 flex flex-col gap-0.5">
                        {glows && (
                          <p className="text-xs text-slate-500 truncate">
                            <span className="font-semibold text-green-700">Glows:</span>{" "}
                            {glows.length > 100 ? glows.slice(0, 100) + "…" : glows}
                          </p>
                        )}
                        {grows && (
                          <p className="text-xs text-slate-500 truncate">
                            <span className="font-semibold text-amber-700">Grows:</span>{" "}
                            {grows.length > 100 ? grows.slice(0, 100) + "…" : grows}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Right: actions ── */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleResume(draft)}
                      disabled={isBeingDeleted || isBeingLoaded}
                      className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
                      style={{ backgroundColor: NAVY, color: "white" }}
                    >
                      {isBeingLoaded
                        ? <Loader2 size={13} className="animate-spin" />
                        : <RotateCcw size={13} />}
                      {isBeingLoaded ? "Loading…" : "Resume"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(draft)}
                      disabled={isBeingDeleted || isBeingLoaded || bulkDeleting}
                      className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-semibold border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* ── Resume: the list steps aside, then comes back ── */}
      {resumeData && (
        <NewObservationModal
          teachers={resumeData.teachers}
          categories={resumeData.categories}
          allDomains={resumeData.allDomains}
          open={resumeOpen}
          onOpenChange={(o) => { if (!o) closeResume(); }}
          defaultTeacherId={resumeData.draft.observedEmployeeId}
          resumeDraftId={resumeData.draft.id}
          rubricSetId={resumeData.draft.rubricSetId}
          /* Discarding from inside the modal returns to this list, so the row
             has to be gone by the time it is visible again. */
          onDraftDiscarded={(id) => {
            removeFromList([id]);
            void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.myDrafts });
            trackEvent("draft_discarded", { surface: "dashboard" });
          }}
          observerName={currentUser?.name}
          canMarkWalkthrough={true}
          onSubmit={handleSubmitResumed}
          saving={resumeSaving}
        />
      )}
    </>
  );
}
