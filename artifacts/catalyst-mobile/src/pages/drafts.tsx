import React, { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useApp } from "@/context/AppContext";
import { AppHeader } from "@/components/AppHeader";
import {
  apiFetch,
  DraftObservation,
  RubricSet,
  fetchMyDrafts,
  deleteObservation,
} from "@/lib/api";
import { FileEdit, Trash2, RotateCcw, FileX, Loader2, AlertCircle } from "lucide-react";
import { isNetworkScope } from "@/lib/roles";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DraftsPage() {
  const { user } = useAuth();
  const { selectedSchool, setSelectedSchool, setSelectedRubric } = useApp();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const networkScope = isNetworkScope(user);

  const [deleting, setDeleting] = useState<string | null>(null);
  const [resumeLoading, setResumeLoading] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const { data: drafts = [], isLoading, isError } = useQuery<DraftObservation[]>({
    queryKey: ["myDrafts"],
    queryFn: fetchMyDrafts,
    enabled: !!user,
    staleTime: 15_000,
  });

  async function handleDelete(draft: DraftObservation) {
    setDeleting(draft.id);
    try {
      await deleteObservation(draft.id);
      await queryClient.invalidateQueries({ queryKey: ["myDrafts"] });
    } catch {
      /* soft-fail: list will refetch */
    } finally {
      setDeleting(null);
    }
  }

  async function handleResume(draft: DraftObservation) {
    setResumeLoading(draft.id);
    setResumeError(null);
    try {
      const rubricSets = await apiFetch<RubricSet[]>("/api/rubric/sets");
      const rubric = rubricSets.find((r) => r.id === draft.rubricSetId);
      if (!rubric) throw new Error("Rubric not found");

      setSelectedRubric(rubric);

      if (!networkScope && user?.schoolId && !selectedSchool) {
        setSelectedSchool({ id: user.schoolId, displayName: user.schoolName ?? "My School" });
      }

      navigate(`/observation?draftId=${draft.id}`);
    } catch (e) {
      setResumeError(e instanceof Error ? e.message : "Could not resume draft");
    } finally {
      setResumeLoading(null);
    }
  }

  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <AppHeader subtitle="My Drafts" />

      <div className="flex-1 overflow-y-auto pb-10 px-4 pt-4 flex flex-col gap-4">

        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center rounded" style={{ backgroundColor: NAVY }}>
            <FileEdit size={18} color={YELLOW} />
          </div>
          <div>
            <h1
              className="uppercase leading-none"
              style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em", fontSize: 22 }}
            >
              My Drafts
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              In-progress observations — auto-saved. Submit when ready.
            </p>
          </div>
        </div>

        {resumeError && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-500" />
            <p className="text-sm text-red-700">{resumeError}</p>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={28} className="animate-spin" style={{ color: NAVY }} />
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertCircle size={32} className="text-red-400" />
            <p className="text-sm font-semibold text-red-500">Failed to load drafts</p>
          </div>
        )}

        {!isLoading && !isError && drafts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <FileX size={48} className="text-slate-300" />
            <p className="text-base font-semibold text-slate-400">No drafts in progress</p>
            <p className="text-sm text-slate-400 max-w-xs">
              Start scoring an observation — it will auto-save here as you go.
            </p>
            <a
              href={`${basePath}/observation`}
              className="mt-2 px-5 py-2 rounded text-sm font-bold text-white"
              style={{ backgroundColor: NAVY }}
            >
              Go to Observation Form
            </a>
          </div>
        )}

        {!isLoading && !isError && drafts.length > 0 && (
          <div className="flex flex-col gap-3">
            {drafts.map((draft) => {
              const scoreCount = Object.keys(draft.scores).length;
              const isBeingDeleted = deleting === draft.id;
              const isBeingLoaded = resumeLoading === draft.id;

              return (
                <div
                  key={draft.id}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-4 flex flex-col gap-3"
                  style={{ opacity: isBeingDeleted ? 0.5 : 1, transition: "opacity 0.2s" }}
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm" style={{ color: NAVY }}>
                        {draft.teacherName ?? `Teacher ${draft.observedEmployeeId}`}
                      </span>
                      {draft.rubricSetName && (
                        <span
                          className="shrink-0 px-2 py-0.5 rounded text-xs font-bold uppercase"
                          style={{ backgroundColor: YELLOW, color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 10, letterSpacing: "0.04em" }}
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
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 flex-wrap">
                      <span>{formatDate(draft.date)}</span>
                      {draft.course && <span>· {draft.course}</span>}
                      <span>
                        · {scoreCount > 0 ? `${scoreCount} domain${scoreCount !== 1 ? "s" : ""} scored` : "No domains scored yet"}
                      </span>
                    </div>
                    {(draft.strengths || draft.growthAreas) && (
                      <div className="mt-1.5 flex flex-col gap-0.5">
                        {draft.strengths && (
                          <p className="text-xs text-slate-500 truncate">
                            <span className="font-semibold text-green-700">Glows:</span>{" "}
                            {draft.strengths.length > 90 ? draft.strengths.slice(0, 90) + "…" : draft.strengths}
                          </p>
                        )}
                        {draft.growthAreas && (
                          <p className="text-xs text-slate-500 truncate">
                            <span className="font-semibold text-amber-700">Grows:</span>{" "}
                            {draft.growthAreas.length > 90 ? draft.growthAreas.slice(0, 90) + "…" : draft.growthAreas}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleResume(draft)}
                      disabled={isBeingDeleted || isBeingLoaded}
                      className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
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

        <div className="pt-4 text-center">
          <a
            href={`${basePath}/observation`}
            className="text-xs font-semibold"
            style={{ color: NAVY }}
          >
            ← Back to observation form
          </a>
        </div>
      </div>
    </div>
  );
}
