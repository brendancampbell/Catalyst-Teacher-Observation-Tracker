import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";
import {
  Plus, X, Check, CheckCircle2, AlertTriangle, Zap,
  BookOpen, Users, ArrowRight, CalendarDays, ChevronRight, GripVertical, Upload,
} from "lucide-react";
import {
  fetchSchoolYears,
  createSchoolYear,
  fetchSchoolYearRubricSets,
  fetchActivationPreview,
  activateSchoolYear,
  reorderSchoolYears,
  copyRubricSetForward,
  fetchRubricSets,
  fetchActivationReadiness,
  previewRoster,
  stageRoster,
  type SchoolYearRow,
  type SchoolYearActivationPreview,
  type RubricSetRow,
  type ActivationReadiness,
  type RosterApplyResult,
} from "@/lib/api";
import type { BulkImportPersonPayload } from "@workspace/api-types";
import { parsePeopleCSV } from "@/lib/peopleCsv";

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
  const [dragOverId, setDragOverId]     = useState<number | null>(null);
  const dragItemId                       = useRef<number | null>(null);

  /* ── Queries ── */
  const yearsQ = useQuery<SchoolYearRow[]>({
    queryKey: QUERY_KEYS.adminSchoolYears,
    queryFn:  fetchSchoolYears,
  });
  const years      = yearsQ.data ?? [];
  const selectedYr = years.find((y) => y.id === selectedId) ?? null;
  const activeYr   = years.find((y) => y.status === "active") ?? null;

  /* Rubric sets for the selected year (already copied / belonging to it) */
  const selectedYrSetsQ = useQuery<RubricSetRow[]>({
    queryKey: [...QUERY_KEYS.schoolYearRubricSets, selectedId],
    queryFn:  () => fetchSchoolYearRubricSets(selectedId!),
    enabled:  selectedId != null,
  });

  /* Active year's non-archived sets — source for copy-forward during setup */
  const activeYrSetsQ = useQuery<RubricSetRow[]>({
    queryKey: QUERY_KEYS.rubricSetsForCopy,
    queryFn:  () => fetchRubricSets(false),
    enabled:  selectedYr?.status === "inactive",
  });

  /* Activation readiness — the three preconditions the gate enforces.
     Fetched with the confirmation dialog so the button can refuse up front
     rather than letting the server 409 after the admin has typed the name. */
  const readinessQ = useQuery<ActivationReadiness>({
    queryKey: [...QUERY_KEYS.activationReadiness, selectedId],
    queryFn:  () => fetchActivationReadiness(selectedId!),
    enabled:  showActivate && selectedId != null,
    staleTime: 0,
  });

  /* Activation preview — fetched lazily when confirmation dialog opens */
  const previewQ = useQuery<SchoolYearActivationPreview>({
    queryKey: [...QUERY_KEYS.activationPreview, selectedId],
    queryFn:  () => fetchActivationPreview(selectedId!),
    enabled:  false,
    staleTime: 0,
  });

  /* ── Mutations ── */
  const createMut = useMutation({
    mutationFn: createSchoolYear,
    onSuccess: (yr) => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.adminSchoolYears });
      setShowCreate(false);
      setNewName("");
      setSelectedId(yr.id);
    },
  });

  const copyMut = useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: number; targetId: number }) =>
      copyRubricSetForward(sourceId, targetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...QUERY_KEYS.schoolYearRubricSets, selectedId] });
    },
  });

  const activateMut = useMutation({
    mutationFn: () => activateSchoolYear(selectedId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.adminSchoolYears });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.schoolYearRubricSets });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.rubricSets });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.rubricSetsForCopy });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.activationPreview });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.quarters });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.latestActionSteps });
      setShowActivate(false);
      setConfirmText("");
    },
  });

  const reorderMut = useMutation({
    mutationFn: (items: { id: number; displayOrder: number }[]) => reorderSchoolYears(items),
    onSuccess: (updated) => {
      qc.setQueryData(QUERY_KEYS.adminSchoolYears, updated);
    },
  });

  function handleMakeActive() {
    setConfirmText("");
    activateMut.reset();
    setShowActivate(true);
    previewQ.refetch();
  }

  const targetSets  = selectedYrSetsQ.data ?? [];
  const sourceSets  = activeYrSetsQ.data ?? [];
  const copiedSlugs = new Set(targetSets.map((s) => s.slug));
  const preview     = previewQ.data;
  const readiness   = readinessQ.data;
  const blocked     = readiness != null && !readiness.ready;

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
          <div className="flex flex-col py-1" style={{ opacity: reorderMut.isPending ? 0.7 : 1 }}>
            {years.map((yr) => {
              const isActive   = yr.status === "active";
              const isSelected = yr.id === selectedId;
              const isDragOver = dragOverId === yr.id;
              return (
                <div
                  key={yr.id}
                  draggable
                  onDragStart={() => { dragItemId.current = yr.id; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverId(yr.id); }}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverId(null);
                    const fromId = dragItemId.current;
                    dragItemId.current = null;
                    if (fromId == null || fromId === yr.id) return;
                    const fromIdx = years.findIndex((y) => y.id === fromId);
                    const toIdx   = years.findIndex((y) => y.id === yr.id);
                    if (fromIdx === -1 || toIdx === -1) return;
                    const reordered = [...years];
                    const [moved] = reordered.splice(fromIdx, 1);
                    reordered.splice(toIdx, 0, moved);
                    reorderMut.mutate(reordered.map((y, i) => ({ id: y.id, displayOrder: i })));
                  }}
                  style={{
                    borderTop: isDragOver ? `2px solid ${YELLOW}` : "2px solid transparent",
                    cursor: "grab",
                  }}
                >
                  <button
                    onClick={() => setSelectedId(yr.id)}
                    className="flex items-center gap-1.5 px-2 py-2.5 text-left w-full transition-colors"
                    style={{
                      backgroundColor: isSelected ? NAVY : "transparent",
                      borderLeft: `3px solid ${isSelected ? YELLOW : "transparent"}`,
                    }}
                  >
                    <GripVertical
                      size={13}
                      className="shrink-0"
                      style={{ color: isSelected ? "rgba(255,255,255,0.4)" : "#cbd5e1" }}
                    />
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
                </div>
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

            <RosterStep
              year={selectedYr}
              activeYearName={activeYr?.name ?? null}
              onGoToUsers={onGoToUsers}
            />

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
              {/* Who gets switched off.

                  First in the dialog, and before the hidden-data summary,
                  because it is the consequence that cannot be undone by
                  switching back the same afternoon. Activating 2026-2027
                  switched off 378 people still on the roster and said so
                  only afterwards, as a number (BACKLOG #38). Names grouped
                  by school are what makes a truncated roster file visible:
                  a school listing its entire staff did not lose its entire
                  staff.                                                    */}
              {!previewQ.isFetching && preview != null && preview.activeYearName && (
                preview.departureCount > 0 ? (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-4 flex flex-col gap-2">
                    <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
                      <AlertTriangle size={14} />
                      <strong>{preview.departureCount}</strong>{" "}
                      {preview.departureCount === 1 ? "person" : "people"} will be switched off
                    </p>
                    <p className="text-xs text-red-700">
                      They hold a place in {preview.activeYearName} and are absent from the{" "}
                      {selectedYr.name} roster, so activating reads them as having left. Check
                      the list before continuing — a school showing all of its staff means the
                      roster file is missing that school, not that everyone there resigned.
                    </p>
                    <div className="max-h-56 overflow-y-auto rounded-md bg-white border border-red-100 divide-y divide-red-100">
                      {preview.departuresBySchool.map((g) => (
                        <div key={g.schoolId ?? "none"} className="px-3 py-2">
                          <p className="text-xs font-semibold text-red-800 flex items-center justify-between gap-2">
                            <span>{g.schoolName}</span>
                            <span className="text-red-500 font-normal shrink-0">
                              {g.people.length}{" "}
                              {g.people.length === 1 ? "person" : "people"}
                            </span>
                          </p>
                          <ul className="mt-1 flex flex-col gap-0.5">
                            {g.people.map((person) => (
                              <li key={person.employeeId} className="text-xs text-slate-600">
                                {person.name}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-red-600">
                      Switching back to {preview.activeYearName} brings them back.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
                    <p className="text-sm text-emerald-800 flex items-center gap-1.5">
                      <CheckCircle2 size={14} />
                      Nobody will be switched off &mdash; everyone in {preview.activeYearName} is
                      on the {selectedYr.name} roster.
                    </p>
                  </div>
                )
              )}

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

              {/* Preconditions — activation is refused until all three hold */}
              {blocked && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-4 flex flex-col gap-2">
                  <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
                    <AlertTriangle size={14} />
                    {selectedYr.name} is not ready to activate
                  </p>
                  <ul className="text-sm text-red-700 ml-5 list-disc flex flex-col gap-1">
                    {readiness!.blockers.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                </div>
              )}

              {activateMut.isError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {(activateMut.error as Error).message}
                </div>
              )}

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
                    if (e.key === "Enter" && confirmMatches && !blocked && !activateMut.isPending) {
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
                disabled={!confirmMatches || blocked || activateMut.isPending}
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

/* ── Step 2: Staff Roster ──────────────────────────────────────────────
   The roster is the authoritative statement of who works where next year.
   Anyone absent from it is deactivated when the year flips, which is why
   the upload is always previewed before it is written.                  */
function RosterStep(
  { year, activeYearName, onGoToUsers }:
  { year: SchoolYearRow; activeYearName: string | null; onGoToUsers: () => void },
) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows]               = useState<BulkImportPersonPayload[] | null>(null);
  const [fileName, setFileName]       = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [applied, setApplied]         = useState<RosterApplyResult | null>(null);
  const [parseError, setParseError]   = useState<string | null>(null);
  const [repairedCount, setRepairedCount] = useState(0);
  const [emailAck, setEmailAck] = useState(false);
  const [missingCols, setMissingCols] = useState<string[]>([]);

  const readinessQ = useQuery<ActivationReadiness>({
    queryKey: [...QUERY_KEYS.activationReadiness, year.id],
    queryFn:  () => fetchActivationReadiness(year.id),
  });

  const previewMut = useMutation({
    mutationFn: (r: BulkImportPersonPayload[]) => previewRoster(year.id, r),
  });

  const applyMut = useMutation({
    mutationFn: () => stageRoster(year.id, rows!, { acknowledgeEmailChanges: emailAck }),
    onSuccess: (res) => {
      setApplied(res);
      setRows(null);
      setFileName("");
      setConfirmText("");
      setEmailAck(false);
      previewMut.reset();
      qc.invalidateQueries({ queryKey: [...QUERY_KEYS.activationReadiness, year.id] });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people });
    },
  });

  const diff = previewMut.data ?? null;
  const confirmMatches = confirmText.trim() === year.name.trim();

  function handleFile(file: File) {
    setApplied(null);
    setParseError(null);
    setRepairedCount(0);
    setEmailAck(false);
    setMissingCols([]);
    previewMut.reset();
    const reader = new FileReader();
    reader.onload = () => {
      const { rows: parsed, malformed, repaired, missing } = parsePeopleCSV(String(reader.result ?? ""));
      setRepairedCount(repaired);
      setMissingCols(missing);
      if (malformed.length > 0) {
        /* Almost always an unquoted comma inside a field: the row gains
           columns and every later one shifts, so importing it would write
           a grade into includeInFeedbackTracker. Refuse rather than guess. */
        const lines = malformed.slice(0, 5).map((m) => m.line).join(", ");
        setParseError(
          `${malformed.length} row${malformed.length !== 1 ? "s have" : " has"} more columns than the header ` +
          `(line${malformed.length !== 1 ? "s" : ""} ${lines}${malformed.length > 5 ? ", …" : ""}). ` +
          `This is usually an unquoted comma — wrap multi-value fields in quotes, e.g. "4, 5, 6".`,
        );
        setRows(null);
        return;
      }
      if (parsed.length === 0) {
        setParseError("No rows found. The file needs a header row with at least firstName, lastName, employeeId, email, role and school.");
        setRows(null);
        return;
      }
      setFileName(file.name);
      setRows(parsed);
      previewMut.mutate(parsed);
    };
    reader.readAsText(file);
  }

  const emptySchools = (diff?.bySchool ?? []).filter((s) => s.remaining === 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100" style={{ borderLeft: `4px solid ${YELLOW}` }}>
        <div className="flex items-center gap-2">
          <Users size={15} style={{ color: NAVY }} />
          <span className="font-bold text-slate-700">Step 2 — Staff Roster</span>
          {readinessQ.data?.hasRoster && (
            <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded"
                  style={{ backgroundColor: "#dcfce7", color: "#15803d" }}>
              Roster loaded
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Upload the complete staff list for {year.name} — everyone, at the school they will be at.
        </p>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
          <p className="text-sm text-slate-600 leading-relaxed">
            This file is the source of truth. Someone listed at a different school is
            <strong> moved</strong>; someone who is not in <em>people</em> yet is <strong>created</strong>;
            and <strong>anyone missing from it is treated as having left</strong> and is deactivated
            when {year.name} goes live. Nothing changes until then — staging cannot disturb the year
            currently running.
          </p>
        </div>

        {/* ── File picker ── */}
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            style={{ color: NAVY }}
          >
            <Upload size={13} />
            Choose roster CSV
          </button>
          {fileName && <span className="text-xs text-slate-500">{fileName} — {rows?.length ?? 0} rows</span>}
          <button
            onClick={onGoToUsers}
            className="ml-auto shrink-0 flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors whitespace-nowrap"
            style={{ color: NAVY }}
          >
            <Users size={13} />
            Edit Users
            <ChevronRight size={13} />
          </button>
        </div>

        {missingCols.length > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            <strong>{missingCols.join(", ")}</strong> {missingCols.length === 1 ? "is" : "are"} not in
            this file's header, so {missingCols.length === 1 ? "it" : "they"} will be empty for every
            row. Check the column {missingCols.length === 1 ? "name" : "names"} if that is unexpected.
          </div>
        )}

        {repairedCount > 0 && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
            <strong>{repairedCount}</strong> row{repairedCount !== 1 ? "s" : ""} had unquoted commas in
            the grade column and {repairedCount !== 1 ? "were" : "was"} reassembled. The grades were
            read correctly, but quoting them (<code>"4, 5, 6"</code>) in your export would remove the
            guesswork.
          </div>
        )}

        {parseError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {parseError}
          </div>
        )}

        {previewMut.isPending && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <div className="w-4 h-4 rounded-full border-2 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
            Comparing against {year.name}…
          </div>
        )}

        {previewMut.isError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Could not preview this roster: {(previewMut.error as Error).message}
          </div>
        )}

        {/* ── The diff ── */}
        {diff && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-5 gap-2">
              {([
                ["New hires",    diff.counts.newHires,    "#dcfce7", "#15803d"],
                ["Moving",       diff.counts.schoolMoves, "#dbeafe", "#1d4ed8"],
                ["Role changes", diff.counts.roleChanges, "#dbeafe", "#1d4ed8"],
                ["Unchanged",    diff.counts.unchanged,   "#f1f5f9", "#475569"],
                ["Departing",    diff.counts.departures,  "#fee2e2", "#b91c1c"],
              ] as const).map(([label, n, bg, fg]) => (
                <div key={label} className="rounded-lg px-3 py-2 text-center" style={{ backgroundColor: bg }}>
                  <div className="font-bold text-lg" style={{ color: fg }}>{n}</div>
                  <div className="text-xs" style={{ color: fg }}>{label}</div>
                </div>
              ))}
            </div>

            {diff.counts.idNormalised > 0 && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
                <strong>{diff.counts.idNormalised}</strong> row
                {diff.counts.idNormalised !== 1 ? "s were" : " was"} matched to an existing person by
                ignoring leading zeros in the employee ID — your export writes <code>15473</code>{" "}
                where HR stores <code>015473</code>. They were matched correctly. Formatting that
                column as text in the export would remove the guesswork.
              </div>
            )}

            {diff.counts.undetectable > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  The departure list below is incomplete
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  <strong>{diff.counts.undetectable}</strong> active staff are absent from this
                  roster but hold no assignment in {activeYearName ?? "the outgoing year"}, so the
                  system cannot tell whether they left. They will not be deactivated. Run the
                  assignments backfill before relying on this list.
                </p>
              </div>
            )}

            {emptySchools.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  {emptySchools.length} school{emptySchools.length !== 1 ? "s" : ""} would have nobody left
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  {emptySchools.map((s) => s.schoolName).join(", ")} — this almost always means the
                  school is missing from the file rather than that everyone there left.
                </p>
              </div>
            )}

            {diff.errors.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm font-semibold text-red-800">
                  {diff.errors.length} row{diff.errors.length !== 1 ? "s" : ""} will be skipped
                </p>
                <ul className="text-xs text-red-700 mt-1 flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                  {diff.errors.slice(0, 25).map((e) => (
                    <li key={e.row}>Row {e.row}{e.name ? ` (${e.name})` : ""} — {e.reason}</li>
                  ))}
                </ul>
              </div>
            )}

            <details className="rounded-lg border border-slate-200">
              <summary className="px-4 py-2 text-sm font-semibold text-slate-700 cursor-pointer">
                Per-school breakdown
              </summary>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-1.5">School</th>
                      <th className="text-right px-3 py-1.5">New</th>
                      <th className="text-right px-3 py-1.5">Moved in</th>
                      <th className="text-right px-3 py-1.5">Departing</th>
                      <th className="text-right px-3 py-1.5">Headcount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.bySchool.map((s) => (
                      <tr key={s.schoolId} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-700">{s.schoolName}</td>
                        <td className="px-3 py-1.5 text-right">{s.newHires}</td>
                        <td className="px-3 py-1.5 text-right">{s.schoolMoves}</td>
                        <td className="px-3 py-1.5 text-right">{s.departures}</td>
                        <td className="px-3 py-1.5 text-right font-semibold"
                            style={{ color: s.remaining === 0 ? "#b91c1c" : "#15803d" }}>
                          {s.remaining}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            {diff.departures.length > 0 && (
              <details className="rounded-lg border border-slate-200">
                <summary className="px-4 py-2 text-sm font-semibold text-slate-700 cursor-pointer">
                  {diff.departures.length} people who will be deactivated
                </summary>
                <ul className="max-h-60 overflow-y-auto px-4 py-2 text-xs text-slate-600 flex flex-col gap-0.5">
                  {diff.departures.map((d) => (
                    <li key={d.employeeId}>{d.name} — {d.schoolName ?? "no school"} ({d.email})</li>
                  ))}
                </ul>
              </details>
            )}

            {diff.emailChanges.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  {diff.emailChanges.length} sign-in address
                  {diff.emailChanges.length !== 1 ? "es" : ""} will change
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  These are matched by employee ID, so the system is confident they are the same
                  people — usually a name change. Their sign-in switches to the new address as soon
                  as you stage this roster, so check each one is a person you expect.
                </p>
                <ul className="mt-2 max-h-48 overflow-y-auto text-xs text-amber-900 flex flex-col gap-1">
                  {diff.emailChanges.map((c) => (
                    <li key={c.employeeId}>
                      <span className="font-semibold">{c.name}</span>{" "}
                      <span className="text-amber-700">({c.employeeId})</span>
                      <br />
                      <span className="line-through opacity-70">{c.from}</span>
                      {" → "}
                      <span className="font-semibold">{c.to}</span>
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex items-start gap-2 text-xs text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={emailAck}
                    onChange={(e) => setEmailAck(e.target.checked)}
                  />
                  <span>
                    I have reviewed these and they are the same people — change their sign-in
                    addresses.
                  </span>
                </label>
              </div>
            )}

            {/* ── Confirm ── */}
            <div className="flex flex-col gap-1.5 pt-1">
              <label className="text-sm font-semibold text-slate-700">
                {diff.emailChanges.length > 0 && !emailAck
                  ? <>Confirm the sign-in address changes above, then type <strong>{year.name}</strong>:</>
                  : <>Read the departure list above, then type <strong>{year.name}</strong> to stage this roster:</>}
              </label>
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder={year.name}
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                />
                <button
                  onClick={() => applyMut.mutate()}
                  disabled={
                    !confirmMatches
                    || applyMut.isPending
                    || (diff.emailChanges.length > 0 && !emailAck)
                  }
                  className="px-5 py-2 rounded-lg font-bold text-sm text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
                >
                  {applyMut.isPending ? "Staging…" : "Stage roster"}
                </button>
              </div>
            </div>
          </div>
        )}

        {applyMut.isError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Could not stage this roster: {(applyMut.error as Error).message}
          </div>
        )}

        {applied && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
            <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
              <CheckCircle2 size={14} />
              Roster staged for {year.name}
            </p>
            <p className="text-xs text-green-700 mt-1">
              {applied.counts.newHires} created, {applied.counts.schoolMoves} moving school.
              {applied.counts.departures > 0
                ? ` ${applied.counts.departures} will be deactivated when this year is activated.`
                : " Nobody will be deactivated."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
