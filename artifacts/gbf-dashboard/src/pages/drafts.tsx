import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { FileEdit, Trash2, RotateCcw, FileX, Loader2 } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/UserContext";
import {
  fetchMyDrafts,
  deleteObservation,
  fetchDashboard,
  createObservation,
  updateObservation,
  type DraftObservation,
  type CategoryEntry,
} from "@/lib/api";
import { NewObservationModal } from "@/components/NewObservationModal";
import { useLocation } from "wouter";
import { toast } from "@/hooks/use-toast";
import type { Teacher, DomainEntry, Score } from "@/data/dummy";

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
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export default function DraftsPage() {
  const { currentUser } = useUser();
  const queryClient     = useQueryClient();
  const baseUrl         = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const [, navigate]    = useLocation();
  const search          = useSearch();
  const [deleting, setDeleting] = useState<string | null>(null);

  /* ── "Back to Dashboard" uses the returnUrl passed from the dashboard ── */
  const rawReturnUrl = new URLSearchParams(search).get("returnUrl");
  const backHref = rawReturnUrl || `${baseUrl}/`;

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
    queryKey:  ["myDrafts"],
    queryFn:   fetchMyDrafts,
    staleTime: 15_000,
  });

  /* ── Handlers ───────────────────────────────────────────────────── */
  async function handleDelete(draft: DraftObservation) {
    setDeleting(draft.id);
    try {
      await deleteObservation(draft.id);
      await queryClient.invalidateQueries({ queryKey: ["myDrafts"] });
      toast({ title: "Draft deleted" });
    } catch {
      toast({ title: "Could not delete draft", variant: "destructive" });
    } finally {
      setDeleting(null);
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
      setResumeData({
        draft,
        teachers:   data.teachers,
        categories: data.categories,
        allDomains,
      });
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

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      <div className="sticky top-0 z-30 shadow-md">
        <AppHeader
          subtitle="My Drafts"
          backHref={backHref}
          backLabel="Back to Dashboard"
          basePath={baseUrl}
          draftsHref={`${baseUrl}/drafts`}
          actionCenterHref={`${baseUrl}/action-center`}
          userName={currentUser.name}
          userEmail={currentUser.email}
          userRole={currentUser.role}
          canAdmin={currentUser.role !== "COACH"}
        />
      </div>

      <main className="flex-1 px-4 sm:px-8 py-8 max-w-5xl mx-auto w-full">

        {/* ── Page title ── */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-9 h-9 flex items-center justify-center rounded"
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
              const isBeingDeleted = deleting    === draft.id;
              const isBeingLoaded  = resumeLoading === draft.id;

              return (
                <div
                  key={draft.id}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4"
                  style={{ opacity: isBeingDeleted ? 0.5 : 1, transition: "opacity 0.2s" }}
                >
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
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                      <span>{formatDate(draft.date)}</span>
                      {draft.course && <span>· {draft.course}</span>}
                      <span>
                        · {scoreCount > 0 ? `${scoreCount} domain${scoreCount !== 1 ? "s" : ""} scored` : "No domains scored yet"}
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
                        : <RotateCcw size={13} />
                      }
                      {isBeingLoaded ? "Loading…" : "Resume"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(draft)}
                      disabled={isBeingDeleted || isBeingLoaded}
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
    </div>
  );
}
