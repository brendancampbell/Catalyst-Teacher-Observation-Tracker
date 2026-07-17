import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  FileEdit, Trash2, RotateCcw, FileX, Loader2,
  CheckSquare, Square, ChevronDown,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/UserContext";
import {
  fetchMyDrafts,
  deleteObservation,
  fetchDashboard,
  fetchMyLatestRubricSlug,
  createObservation,
  updateObservation,
  type DraftObservation,
  type CategoryEntry,
} from "@/lib/api";
import { NewObservationModal } from "@/components/NewObservationModal";
import { useLocation } from "wouter";
import { toast } from "@/hooks/use-toast";
import type { Teacher, DomainEntry, Score } from "@/data/dummy";
import { safeReturnTo } from "@/lib/safeReturnTo";

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

export default function DraftsPage() {
  const { currentUser } = useUser();
  const queryClient     = useQueryClient();
  const baseUrl         = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const [, navigate]    = useLocation();
  const search          = useSearch();

  const [deleting,      setDeleting]      = useState<string | null>(null);
  const [bulkDeleting,  setBulkDeleting]  = useState(false);
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [staleMenuOpen, setStaleMenuOpen] = useState(false);

  const parsedSearch = new URLSearchParams(search);
  const rawReturnUrl = parsedSearch.get("returnUrl");
  const backHref = safeReturnTo(rawReturnUrl, `${baseUrl}/`);
  const schoolAbbreviation = parsedSearch.get("schoolAbbreviation") ?? currentUser?.schoolAbbreviation ?? null;
  const schoolIdParam = parsedSearch.get("schoolId");
  const schoolId = schoolIdParam != null ? parseInt(schoolIdParam, 10) : null;
  const effectiveSchoolId = schoolId != null && !isNaN(schoolId) ? schoolId : null;
  const schoolName = parsedSearch.get("schoolName") ?? null;
  const acParams = new URLSearchParams();
  if (effectiveSchoolId != null) acParams.set("schoolId", String(effectiveSchoolId));
  if (schoolName)               acParams.set("schoolName", schoolName);
  if (schoolAbbreviation)       acParams.set("schoolAbbreviation", schoolAbbreviation);
  const actionCenterHref = `${baseUrl}/action-center${acParams.toString() ? `?${acParams.toString()}` : ""}`;

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

  /* ── New-observation modal state ─────────────────────────────────── */
  const [newObsOpen,    setNewObsOpen]    = useState(false);
  const [newObsLoading, setNewObsLoading] = useState(false);
  const [newObsSaving,  setNewObsSaving]  = useState(false);
  const [newObsData, setNewObsData] = useState<{
    teachers:    Teacher[];
    categories:  CategoryEntry[];
    allDomains:  DomainEntry[];
    rubricSetId: number;
  } | null>(null);

  /* ── Drafts query ───────────────────────────────────────────────── */
  const { data: drafts = [], isLoading, isError } = useQuery<DraftObservation[]>({
    queryKey:  ["myDrafts"],
    queryFn:   fetchMyDrafts,
    staleTime: 15_000,
  });

  /* ── Selection helpers ──────────────────────────────────────────── */
  const emptyDraftIds  = useMemo(() => drafts.filter(isDraftEmpty).map((d) => d.id), [drafts]);
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
  async function handleDelete(draft: DraftObservation) {
    setDeleting(draft.id);
    try {
      await deleteObservation(draft.id);
      setSelected((prev) => { const next = new Set(prev); next.delete(draft.id); return next; });
      await queryClient.invalidateQueries({ queryKey: ["myDrafts"] });
      toast({ title: "Draft deleted" });
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
      await queryClient.invalidateQueries({ queryKey: ["myDrafts"] });
      toast({ title: `Deleted ${count} draft${count !== 1 ? "s" : ""}` });
    } catch {
      toast({ title: "Some drafts could not be deleted", variant: "destructive" });
      await queryClient.invalidateQueries({ queryKey: ["myDrafts"] });
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleNewObsClick() {
    setNewObsLoading(true);
    try {
      const activeSlug = await fetchMyLatestRubricSlug() ?? "Q1";
      const data = await fetchDashboard(activeSlug, currentUser?.schoolId ?? null);
      const allDomains = data.categories.flatMap((c) => c.domains);
      setNewObsData({ teachers: data.teachers, categories: data.categories, allDomains, rubricSetId: data.rubricSet.id });
      setNewObsOpen(true);
    } catch {
      toast({ title: "Could not load observation form", variant: "destructive" });
    } finally {
      setNewObsLoading(false);
    }
  }

  async function handleSubmitNew(
    teacherId:    string,
    date:         string,
    scores:       Record<string, Score>,
    strengths:    string,
    growthAreas:  string,
    isWalkthrough: boolean,
    time:         string,
    course:       string,
  ): Promise<string> {
    if (!newObsData) return "";
    setNewObsSaving(true);
    try {
      const obs = await createObservation({
        teacherId,
        rubricSetId:  newObsData.rubricSetId,
        date,
        time:         time        || undefined,
        course:       course      || undefined,
        scores,
        strengths:    strengths   || undefined,
        growthAreas:  growthAreas || undefined,
        observer:     currentUser?.name ?? "Unknown",
        observerId:   currentUser?.id,
        isWalkthrough,
        status: "published",
      });
      await queryClient.invalidateQueries({ queryKey: ["myDrafts"] });
      toast({ title: "Observation submitted!" });
      return String(obs.id);
    } catch (err) {
      console.error("Failed to submit observation:", err);
      toast({ title: "Failed to submit observation", variant: "destructive" });
      return "";
    } finally {
      setNewObsSaving(false);
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
      setResumeOpen(true);
    } catch {
      toast({ title: "Could not load draft data", variant: "destructive" });
    } finally {
      setResumeLoading(null);
    }
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
  ): Promise<string> {
    if (!resumeData) return "";
    setResumeSaving(true);
    try {
      let obs;
      if (draftId) {
        obs = await updateObservation(draftId, {
          strengths:   strengths   || undefined,
          growthAreas: growthAreas || undefined,
          scores,
          status: "published",
        });
      } else {
        obs = await createObservation({
          teacherId,
          rubricSetId:  resumeData.draft.rubricSetId,
          date,
          time:         time   || undefined,
          course:       course || undefined,
          scores,
          strengths:    strengths   || undefined,
          growthAreas:  growthAreas || undefined,
          observer:     currentUser?.name ?? "Unknown",
          observerId:   currentUser?.id,
          isWalkthrough,
          status: "published",
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["myDrafts"] });
      toast({ title: "Observation submitted!" });
      return String(obs.id);
    } catch (err) {
      console.error("Failed to submit observation:", err);
      toast({ title: "Failed to submit observation", variant: "destructive" });
      return "";
    } finally {
      setResumeSaving(false);
    }
  }

  if (!currentUser) return null;

  const emptyCount = emptyDraftIds.length;

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      <div className="sticky top-0 z-30 shadow-md">
        <AppHeader
          subtitle="My Drafts"
          backHref={backHref}
          backLabel="Back to Dashboard"
          basePath={baseUrl}
          draftsHref={`${baseUrl}/drafts`}
          actionCenterHref={actionCenterHref}
          schoolAbbreviation={schoolAbbreviation}
          userName={currentUser.name}
          userEmail={currentUser.email}
          userRole={currentUser.role}
          canAdmin={currentUser.role !== "COACH"}
          onAddObservation={handleNewObsClick}
        />
      </div>

      <main className="flex-1 px-4 sm:px-8 py-8 max-w-5xl mx-auto w-full">

        {/* ── Page title + quick-select toolbar ── */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 flex items-center justify-center rounded shrink-0"
              style={{ backgroundColor: NAVY }}
            >
              <FileEdit size={18} color={YELLOW} />
            </div>
            <div>
              <h1
                className="text-2xl uppercase leading-none"
                style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em" }}
              >
                My Drafts
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Observations in progress — auto-saved. Submit when you're ready to publish.
              </p>
            </div>
          </div>
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
              Start an observation from the dashboard — it will auto-save here as you go.
            </p>
            <a
              href={backHref}
              className="mt-2 px-5 py-2 rounded text-sm font-bold text-white"
              style={{ backgroundColor: NAVY }}
            >
              Go to Dashboard
            </a>
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
      </main>

      {/* ── New observation modal ── */}
      {newObsData && (
        <NewObservationModal
          teachers={newObsData.teachers}
          categories={newObsData.categories}
          allDomains={newObsData.allDomains}
          open={newObsOpen}
          onOpenChange={(o) => { setNewObsOpen(o); if (!o) setNewObsData(null); }}
          observerName={currentUser.name}
          canMarkWalkthrough={currentUser.role !== "COACH"}
          onSubmit={handleSubmitNew}
          saving={newObsSaving}
          freshStart
        />
      )}

      {/* ── Resume modal (opens inline on this page) ── */}
      {resumeData && (
        <NewObservationModal
          teachers={resumeData.teachers}
          categories={resumeData.categories}
          allDomains={resumeData.allDomains}
          open={resumeOpen}
          onOpenChange={(o) => { setResumeOpen(o); if (!o) setResumeData(null); }}
          defaultTeacherId={resumeData.draft.observedEmployeeId}
          resumeDraftId={resumeData.draft.id}
          rubricSetId={resumeData.draft.rubricSetId}
          observerName={currentUser.name}
          canMarkWalkthrough={currentUser.role !== "COACH"}
          onSubmit={handleSubmitResumed}
          saving={resumeSaving}
        />
      )}

      <footer className="text-center pt-1 pb-4" style={{ color: "#94a3b8", fontSize: 12, fontFamily: "'Libre Franklin', sans-serif" }}>
        &copy; {new Date().getFullYear()} Uncommon Schools, Inc. All rights reserved. | This site is in beta and may have bugs. Share feedback and ideas by completing <a href="https://docs.google.com/forms/d/e/1FAIpQLScGsGBwHNyxAv1jcKYR5Q85gHbIZpUojwVW9PxrgJm7zv20jw/viewform?usp=header" target="_blank" rel="noopener noreferrer" style={{ color: "#64748b", fontWeight: 600 }}>this form</a>.
      </footer>
    </div>
  );
}
