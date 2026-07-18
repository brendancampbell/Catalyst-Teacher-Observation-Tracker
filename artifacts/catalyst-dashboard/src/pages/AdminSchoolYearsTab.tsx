import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, X, Check, CheckCircle2, AlertTriangle, Zap,
  BookOpen, Users, ArrowRight, CalendarDays, ChevronRight,
} from "lucide-react";
import {
  fetchSchoolYears,
  createSchoolYear,
  fetchSchoolYearRubricSets,
  fetchActivationPreview,
  activateSchoolYear,
  copyRubricSetForward,
  fetchRubricSets,
  type SchoolYearRow,
  type SchoolYearActivationPreview,
  type RubricSetRow,
} from "@/lib/api";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

interface Props {
  onGoToUsers: () => void;
}

export function AdminSchoolYearsTab({ onGoToUsers }: Props) {
  const qc = useQueryClient();

  const [selectedId, setSelectedId]     = useState<number | null>(null);
  const [showCreate, setShowCreate]     = useState(false);
  const [newName, setNewName]           = useState("");
  const [showActivate, setShowActivate] = useState(false);
  const [confirmText, setConfirmText]   = useState("");

  /* ── Queries ── */
  const yearsQ = useQuery<SchoolYearRow[]>({
    queryKey: ["admin-school-years"],
    queryFn:  fetchSchoolYears,
  });
  const years      = yearsQ.data ?? [];
  const selectedYr = years.find((y) => y.id === selectedId) ?? null;
  const activeYr   = years.find((y) => y.status === "active") ?? null;

  /* Rubric sets for the selected year (already copied / belonging to it) */
  const selectedYrSetsQ = useQuery<RubricSetRow[]>({
    queryKey: ["school-year-rubric-sets", selectedId],
    queryFn:  () => fetchSchoolYearRubricSets(selectedId!),
    enabled:  selectedId != null,
  });

  /* Active year's non-archived sets — source for copy-forward during setup */
  const activeYrSetsQ = useQuery<RubricSetRow[]>({
    queryKey: ["rubric-sets-for-copy"],
    queryFn:  () => fetchRubricSets(false),
    enabled:  selectedYr?.status === "inactive",
  });

  /* Activation preview — fetched lazily when confirmation dialog opens */
  const previewQ = useQuery<SchoolYearActivationPreview>({
    queryKey: ["activation-preview", selectedId],
    queryFn:  () => fetchActivationPreview(selectedId!),
    enabled:  false,
    staleTime: 0,
  });

  /* ── Mutations ── */
  const createMut = useMutation({
    mutationFn: createSchoolYear,
    onSuccess: (yr) => {
      qc.invalidateQueries({ queryKey: ["admin-school-years"] });
      setShowCreate(false);
      setNewName("");
      setSelectedId(yr.id);
    },
  });

  const copyMut = useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: number; targetId: number }) =>
      copyRubricSetForward(sourceId, targetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["school-year-rubric-sets", selectedId] });
    },
  });

  const activateMut = useMutation({
    mutationFn: () => activateSchoolYear(selectedId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-school-years"] });
      qc.invalidateQueries({ queryKey: ["school-year-rubric-sets"] });
      qc.invalidateQueries({ queryKey: ["rubric-sets"] });
      qc.invalidateQueries({ queryKey: ["rubric-sets-for-copy"] });
      qc.invalidateQueries({ queryKey: ["activation-preview"] });
      setShowActivate(false);
      setConfirmText("");
    },
  });

  function handleMakeActive() {
    setConfirmText("");
    setShowActivate(true);
    previewQ.refetch();
  }

  const targetSets  = selectedYrSetsQ.data ?? [];
  const sourceSets  = activeYrSetsQ.data ?? [];
  const copiedSlugs = new Set(targetSets.map((s) => s.slug));
  const preview     = previewQ.data;

  const confirmMatches =
    selectedYr != null && confirmText.trim() === selectedYr.name.trim();

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* ═══════════════════ Left sidebar ═══════════════════ */}
      <div
        className="flex flex-col bg-white shrink-0"
        style={{ width: 252, borderRight: "1px solid #e2e8f0", overflowY: "auto" }}
      >
        <div className="px-4 pt-3 pb-1" style={{ borderBottom: `2px solid ${YELLOW}` }}>
          <span
            className="font-bold uppercase"
            style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.04em" }}
          >
            School Years
          </span>
        </div>

        {yearsQ.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="inline-block w-6 h-6 rounded-full border-2 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
          </div>
        ) : (
          <div className="flex flex-col py-1">
            {years.map((yr) => {
              const isActive   = yr.status === "active";
              const isSelected = yr.id === selectedId;
              return (
                <button
                  key={yr.id}
                  onClick={() => setSelectedId(yr.id)}
                  className="flex items-center gap-2 px-3 py-2.5 text-left w-full transition-colors"
                  style={{
                    backgroundColor: isSelected ? NAVY : "transparent",
                    borderLeft: `3px solid ${isSelected ? YELLOW : "transparent"}`,
                  }}
                >
                  <span
                    className="flex-1 min-w-0 truncate font-bold"
                    style={{
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 17,
                      letterSpacing: "0.03em",
                      color: isSelected ? "white" : NAVY,
                    }}
                  >
                    {yr.name}
                  </span>
                  <span
                    className="shrink-0 text-xs font-bold px-1.5 py-0.5 rounded"
                    style={
                      isActive
                        ? { backgroundColor: "#dcfce7", color: "#15803d" }
                        : { backgroundColor: "#f1f5f9", color: "#94a3b8" }
                    }
                  >
                    {isActive ? "ACTIVE" : "inactive"}
                  </span>
                </button>
              );
            })}
            {years.length === 0 && (
              <p className="px-4 py-3 text-sm text-slate-400 italic">No school years yet.</p>
            )}
          </div>
        )}

        <div className="mt-auto p-3 border-t border-slate-100">
          <button
            onClick={() => { setShowCreate(true); setNewName(""); }}
            className="flex items-center justify-center gap-1.5 w-full font-bold rounded-md px-3 py-2 text-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, letterSpacing: "0.04em" }}
          >
            <Plus size={15} />
            New School Year
          </button>
        </div>
      </div>

      {/* ═══════════════════ Right panel ═══════════════════ */}
      <div className="flex-1 overflow-y-auto px-6 py-5" style={{ backgroundColor: "#F4F6FB" }}>

        {selectedYr == null ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
            <CalendarDays size={40} className="text-slate-300" />
            <p className="text-slate-400 text-sm">Select a school year from the list to view its details.</p>
          </div>

        ) : selectedYr.status === "active" ? (
          /* ── Active year detail ── */
          <div className="max-w-2xl flex flex-col gap-4">
            <div className="rounded-xl border-2 border-green-200 bg-green-50 px-5 py-4 flex items-start gap-3">
              <CheckCircle2 size={22} className="shrink-0 text-green-600 mt-0.5" />
              <div>
                <p className="font-bold text-green-800">{selectedYr.name} is the current active school year.</p>
                <p className="text-sm text-green-700 mt-0.5">
                  All observations, action steps, rubric data, and AI context are scoped to this year.
                  Non-admin users only see data from this year.
                </p>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-xs uppercase tracking-widest text-slate-400 mb-2">Rubric sets in this year</h3>
              {selectedYrSetsQ.isLoading ? (
                <div className="w-6 h-6 rounded-full border-2 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
              ) : targetSets.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No rubric sets found for this year.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {targetSets.map((s) => (
                    <div
                      key={s.slug}
                      className="bg-white rounded-lg border border-slate-200 px-4 py-3 flex items-center gap-3"
                    >
                      <BookOpen size={14} className="shrink-0 text-slate-400" />
                      <span className="flex-1 font-semibold text-slate-700 text-sm">{s.name}</span>
                      <span className="text-xs text-slate-400">
                        {s.target === "SCHOOL" ? "School-Wide" : "Teacher"} ·{" "}
                        {s.subjectAudience === "ALL" ? "All Subjects" : s.subjectAudience}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-200">
              <p className="text-xs text-slate-400 italic">
                To switch to a different year, select it from the list and click "Make Active."
              </p>
            </div>
          </div>

        ) : (
          /* ── Inactive year setup ── */
          <div className="max-w-2xl flex flex-col gap-5">
            <div>
              <h2
                className="font-bold"
                style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: "0.04em" }}
              >
                Setup: {selectedYr.name}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                This year is inactive and invisible to non-admin users. Complete the setup steps below,
                then activate when ready.
              </p>
            </div>

            {/* ── Step 1: Rubric Sets ── */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div
                className="px-5 py-4 border-b border-slate-100"
                style={{ borderLeft: `4px solid ${NAVY}` }}
              >
                <div className="flex items-center gap-2">
                  <BookOpen size={15} style={{ color: NAVY }} />
                  <span className="font-bold text-slate-700">Step 1 — Rubric Sets</span>
                  {targetSets.length > 0 && (
                    <span
                      className="ml-auto text-xs font-bold px-2 py-0.5 rounded"
                      style={{ backgroundColor: "#dcfce7", color: "#15803d" }}
                    >
                      {targetSets.length} copied
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  Copy rubric sets from the current active year ({activeYr?.name ?? "none"}) into{" "}
                  {selectedYr.name} as independent versions, or leave them behind.
                </p>
              </div>

              <div className="px-5 py-4">
                {activeYr == null ? (
                  <p className="text-sm text-slate-400 italic">No active school year to copy from.</p>
                ) : activeYrSetsQ.isLoading ? (
                  <div className="w-6 h-6 rounded-full border-2 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
                ) : sourceSets.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">
                    No rubric sets in the active year ({activeYr.name}).
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3 text-xs font-bold text-slate-400 uppercase tracking-wider px-1 pb-0.5">
                      <span>From {activeYr.name}</span>
                      <span>In {selectedYr.name}</span>
                    </div>
                    {sourceSets.map((src) => {
                      const isCopied  = copiedSlugs.has(src.slug);
                      const isLoading =
                        copyMut.isPending && (copyMut.variables as { sourceId: number } | undefined)?.sourceId === src.id;
                      return (
                        <div key={src.slug} className="grid grid-cols-2 gap-3 items-center">
                          <div className="flex items-center gap-2 bg-slate-50 rounded-lg border border-slate-100 px-3 py-2 min-w-0">
                            <BookOpen size={12} className="shrink-0 text-slate-400" />
                            <span className="text-sm font-semibold text-slate-700 truncate">{src.name}</span>
                          </div>
                          {isCopied ? (
                            <div
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border"
                              style={{ backgroundColor: "#f0fdf4", color: "#15803d", borderColor: "#bbf7d0" }}
                            >
                              <Check size={13} />
                              Copied
                            </div>
                          ) : (
                            <button
                              onClick={() =>
                                copyMut.mutate({ sourceId: src.id, targetId: selectedId! })
                              }
                              disabled={isLoading || copyMut.isPending}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50 hover:opacity-80"
                              style={{ backgroundColor: NAVY, color: "white" }}
                            >
                              {isLoading ? (
                                <span
                                  className="inline-block w-3 h-3 rounded-full border-2 border-blue-300 animate-spin"
                                  style={{ borderTopColor: "white" }}
                                />
                              ) : (
                                <ArrowRight size={13} />
                              )}
                              Copy Forward
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {/* Extra sets already in target that aren't in source (manually created) */}
                    {targetSets
                      .filter((t) => !sourceSets.some((s) => s.slug === t.slug))
                      .map((t) => (
                        <div key={t.slug} className="grid grid-cols-2 gap-3 items-center">
                          <div className="flex items-center gap-2 bg-slate-50 rounded-lg border border-dashed border-slate-200 px-3 py-2 min-w-0">
                            <BookOpen size={12} className="shrink-0 text-slate-300" />
                            <span className="text-sm text-slate-400 truncate italic">(not in active year)</span>
                          </div>
                          <div
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border"
                            style={{ backgroundColor: "#f0fdf4", color: "#15803d", borderColor: "#bbf7d0" }}
                          >
                            <Check size={13} />
                            {t.name}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Step 2: User Assignments ── */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div
                className="px-5 py-4 border-b border-slate-100"
                style={{ borderLeft: `4px solid ${YELLOW}` }}
              >
                <div className="flex items-center gap-2">
                  <Users size={15} style={{ color: NAVY }} />
                  <span className="font-bold text-slate-700">Step 2 — User Assignments</span>
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  Review who will have access when this year becomes active.
                </p>
              </div>
              <div className="px-5 py-4 flex items-start justify-between gap-4">
                <p className="text-sm text-slate-600 leading-relaxed">
                  All currently active users retain their role and school assignment automatically.
                  To deactivate a user or change their school before switching, use the Users tab.
                  Users you mark inactive there won't appear in the app once this year is live.
                </p>
                <button
                  onClick={onGoToUsers}
                  className="shrink-0 flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors whitespace-nowrap"
                  style={{ color: NAVY }}
                >
                  <Users size={13} />
                  Edit Users
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>

            {/* ── Make Active CTA ── */}
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-200">
              <p className="text-xs text-slate-400">
                Activating is reversible — you can switch back to any year at any time.
              </p>
              <button
                onClick={handleMakeActive}
                className="shrink-0 flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: NAVY,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 18,
                  letterSpacing: "0.04em",
                }}
              >
                <Zap size={16} />
                Make {selectedYr.name} Active
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════ Create dialog ═══════════════════ */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div
              className="px-5 py-4 flex items-center justify-between"
              style={{ backgroundColor: NAVY, borderBottom: `3px solid ${YELLOW}` }}
            >
              <h2
                className="text-white font-bold uppercase tracking-wide"
                style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.04em" }}
              >
                New School Year
              </h2>
              <button onClick={() => setShowCreate(false)} className="text-blue-200 hover:text-white p-1">
                <X size={20} />
              </button>
            </div>

            <div className="px-5 py-5 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700">School Year Name</label>
                <input
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="e.g. 2026-27"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) createMut.mutate(newName.trim());
                  }}
                  autoFocus
                />
                <p className="text-xs text-slate-400">
                  The new school year starts as inactive. Only Network Admins can see it
                  until you explicitly activate it.
                </p>
              </div>
            </div>

            <div className="px-5 pb-5 flex justify-end gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => createMut.mutate(newName.trim())}
                disabled={!newName.trim() || createMut.isPending}
                className="px-5 py-2 rounded-lg font-bold text-sm text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
              >
                {createMut.isPending ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════ Activation confirmation dialog ═══════════════════ */}
      {showActivate && selectedYr && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !activateMut.isPending) {
              setShowActivate(false);
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div
              className="px-5 py-4"
              style={{ backgroundColor: NAVY, borderBottom: `3px solid ${YELLOW}` }}
            >
              <h2
                className="text-white font-bold uppercase"
                style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.04em" }}
              >
                Activate {selectedYr.name}?
              </h2>
            </div>

            <div className="px-5 py-5 flex flex-col gap-4">
              {/* Impact summary */}
              {previewQ.isFetching ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <div
                    className="w-4 h-4 rounded-full border-2 border-blue-200 animate-spin"
                    style={{ borderTopColor: NAVY }}
                  />
                  Calculating impact…
                </div>
              ) : preview != null ? (
                preview.activeYearName ? (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-4 flex flex-col gap-2">
                    <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                      <AlertTriangle size={14} />
                      Switching from {preview.activeYearName} to {selectedYr.name} will hide:
                    </p>
                    <ul className="text-sm text-amber-700 ml-5 list-disc flex flex-col gap-1">
                      {preview.openDrafts > 0 && (
                        <li>
                          <strong>{preview.openDrafts}</strong>{" "}
                          open draft{preview.openDrafts !== 1 ? "s" : ""}
                        </li>
                      )}
                      {preview.unresolvedActionSteps > 0 && (
                        <li>
                          <strong>{preview.unresolvedActionSteps}</strong>{" "}
                          unresolved action step{preview.unresolvedActionSteps !== 1 ? "s" : ""}
                        </li>
                      )}
                      {preview.rescoreQueueItems > 0 && (
                        <li>
                          <strong>{preview.rescoreQueueItems}</strong>{" "}
                          rescore queue item{preview.rescoreQueueItems !== 1 ? "s" : ""}
                        </li>
                      )}
                      {preview.schoolsAffected > 0 && (
                        <li>
                          across <strong>{preview.schoolsAffected}</strong>{" "}
                          school{preview.schoolsAffected !== 1 ? "s" : ""}
                        </li>
                      )}
                      {preview.openDrafts === 0 &&
                        preview.unresolvedActionSteps === 0 &&
                        preview.rescoreQueueItems === 0 && (
                          <li>nothing — no open drafts, action steps, or rescore items</li>
                        )}
                    </ul>
                    <p className="text-xs text-amber-600 mt-0.5">
                      This does not delete any data. You can switch back to any year at any time.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                    <p className="text-sm text-blue-700">
                      No currently active school year. This will be the first active year.
                    </p>
                  </div>
                )
              ) : null}

              {/* Confirm by typing */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  Type <strong>{selectedYr.name}</strong> to confirm:
                </label>
                <input
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder={selectedYr.name}
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && confirmMatches && !activateMut.isPending) {
                      activateMut.mutate();
                    }
                  }}
                  autoFocus
                />
              </div>
            </div>

            <div className="px-5 pb-5 flex justify-end gap-3">
              <button
                onClick={() => { setShowActivate(false); setConfirmText(""); }}
                disabled={activateMut.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => activateMut.mutate()}
                disabled={!confirmMatches || activateMut.isPending}
                className="px-5 py-2 rounded-xl font-bold text-sm text-white disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center gap-2"
                style={{
                  backgroundColor: NAVY,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 14,
                  letterSpacing: "0.02em",
                }}
              >
                {activateMut.isPending ? (
                  <>
                    <span
                      className="inline-block w-4 h-4 rounded-full border-2 border-blue-300 animate-spin"
                      style={{ borderTopColor: "white" }}
                    />
                    Activating…
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    Activate {selectedYr.name}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
